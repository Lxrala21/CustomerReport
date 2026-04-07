const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// ── MongoDB Atlas ──
const MONGO_URI = process.env.MONGO_URI;
let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.log('MongoDB Atlas conectado — customerreport_db');
}

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Schema reutilizable para customers ──
const customerFields = {
    customer:   { type: String, default: '' },
    company:    { type: String, default: '' },
    email:      { type: String, default: '' },
    phone:      { type: String, default: '' },
    bought:     { type: Number, default: 0 },
    boughtMXN:  { type: Number, default: 0 },
    paid:       { type: Number, default: 0 },
    paidMXN:    { type: Number, default: 0 },
    balance:    { type: Number, default: 0 },
    balanceMXN: { type: Number, default: 0 },
    rate:       { type: Number, default: 0 },
    firstDate:  { type: Date, default: null },
    lastDate:   { type: Date, default: null },
    daysAgo:    { type: Number, default: 0 },
    sr1:        { type: String, default: '' },
    sr2:        { type: String, default: '' },
};

const schemaOpts = { timestamps: false, versionKey: false };

// ── Colecciones por pestaña ──
const TABS = {
    rawdata:     { name: 'Raw Data',        collection: 'rawdata' },
    balance:     { name: 'Balance Details',  collection: 'balance' },
    employees:   { name: 'Employees',        collection: 'employees' },
    lorena:      { name: 'Lorena',           collection: 'lorena' },
    notassigned: { name: 'Not Assigned',     collection: 'notassigned' },
};

// Crear modelos dinámicamente (evitar recompilación en serverless)
const models = {};
Object.entries(TABS).forEach(([key, tab]) => {
    if (mongoose.models[tab.collection]) {
        models[key] = mongoose.models[tab.collection];
    } else {
        const schema = new mongoose.Schema(customerFields, { ...schemaOpts, collection: tab.collection });
        models[key] = mongoose.model(tab.collection, schema);
    }
});

// ── Schema: Import metadata ──
const Import = mongoose.models.Import || mongoose.model('Import', new mongoose.Schema({
    reportTitle: { type: String, default: '' },
    tabs: [{ tab: String, count: Number }],
    totalRecords: { type: Number, default: 0 },
    importedAt: { type: Date, default: Date.now },
}, schemaOpts));

// ── Schema: Weekly snapshots ──
const Snapshot = mongoose.models.Snapshot || mongoose.model('Snapshot', new mongoose.Schema({
    date:      { type: Date, required: true },
    label:     { type: String, default: '' },
    bought:    { type: Number, default: 0 },
    paid:      { type: Number, default: 0 },
    balance:   { type: Number, default: 0 },
    clients:   { type: Number, default: 0 },
}, { ...schemaOpts, collection: 'snapshots' }));

// ── Conectar DB antes de cada request ──
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        res.status(500).json({ ok: false, error: 'DB connection failed: ' + err.message });
    }
});

// ── Routes ──

// GET /api/customers
app.get('/api/customers', async (req, res) => {
    try {
        const customers = await models.rawdata.find().lean();
        const meta = await Import.findOne().sort({ importedAt: -1 }).lean();
        res.json({ ok: true, data: customers, meta });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/tab/:tab
app.get('/api/tab/:tab', async (req, res) => {
    try {
        const tab = req.params.tab;
        if (!models[tab]) return res.status(400).json({ ok: false, error: `Tab "${tab}" no existe` });
        const data = await models[tab].find().lean();
        const meta = await Import.findOne().sort({ importedAt: -1 }).lean();
        res.json({ ok: true, tab, count: data.length, data, meta });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/tabs
app.get('/api/tabs', async (req, res) => {
    try {
        const result = {};
        for (const [key, tab] of Object.entries(TABS)) {
            const count = await models[key].countDocuments();
            result[key] = { name: tab.name, count };
        }
        const meta = await Import.findOne().sort({ importedAt: -1 }).lean();
        res.json({ ok: true, tabs: result, meta });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/import
app.post('/api/import', async (req, res) => {
    try {
        const { customers, reportTitle } = req.body;
        if (!customers || !Array.isArray(customers)) {
            return res.status(400).json({ ok: false, error: 'Se requiere array de customers' });
        }
        await models.rawdata.deleteMany({});
        if (customers.length > 0) {
            await models.rawdata.insertMany(customers, { ordered: false });
        }
        await Import.deleteMany({});
        await Import.create({
            reportTitle: reportTitle || '',
            tabs: [{ tab: 'rawdata', count: customers.length }],
            totalRecords: customers.length,
            importedAt: new Date(),
        });
        res.json({ ok: true, count: customers.length });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/import-all
app.post('/api/import-all', async (req, res) => {
    try {
        const { tabs: tabsData, reportTitle } = req.body;
        if (!tabsData || typeof tabsData !== 'object') {
            return res.status(400).json({ ok: false, error: 'Se requiere objeto tabs con arrays' });
        }
        const tabCounts = [];
        let totalRecords = 0;
        for (const [key, data] of Object.entries(tabsData)) {
            if (!models[key]) continue;
            if (!Array.isArray(data)) continue;
            await models[key].deleteMany({});
            if (data.length > 0) {
                await models[key].insertMany(data, { ordered: false });
            }
            tabCounts.push({ tab: key, count: data.length });
            totalRecords += data.length;
        }
        await Import.deleteMany({});
        await Import.create({
            reportTitle: reportTitle || '',
            tabs: tabCounts,
            totalRecords,
            importedAt: new Date(),
        });
        res.json({ ok: true, tabs: tabCounts, totalRecords });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/status
app.get('/api/status', async (req, res) => {
    try {
        const tabCounts = {};
        for (const key of Object.keys(TABS)) {
            tabCounts[key] = await models[key].countDocuments();
        }
        const meta = await Import.findOne().sort({ importedAt: -1 }).lean();
        res.json({
            ok: true,
            connected: mongoose.connection.readyState === 1,
            tabs: tabCounts,
            customers: tabCounts.rawdata || 0,
            lastImport: meta ? meta.importedAt : null,
            reportTitle: meta ? meta.reportTitle : '',
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/snapshot
app.post('/api/snapshot', async (req, res) => {
    try {
        const { date, label, bought, paid, balance, clients } = req.body;
        const snapDate = new Date(date);
        snapDate.setHours(0, 0, 0, 0);
        const existing = await Snapshot.findOne({
            date: { $gte: snapDate, $lt: new Date(snapDate.getTime() + 86400000) }
        });
        if (existing) {
            existing.label = label || existing.label;
            existing.bought = bought;
            existing.paid = paid;
            existing.balance = balance;
            existing.clients = clients;
            await existing.save();
            res.json({ ok: true, updated: true });
        } else {
            await Snapshot.create({ date: snapDate, label, bought, paid, balance, clients });
            res.json({ ok: true, created: true });
        }
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/snapshots
app.get('/api/snapshots', async (req, res) => {
    try {
        const data = await Snapshot.find().sort({ date: 1 }).lean();
        res.json({ ok: true, data });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE /api/snapshot/:id
app.delete('/api/snapshot/:id', async (req, res) => {
    try {
        await Snapshot.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = app;
