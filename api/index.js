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
    if (isConnected && mongoose.connection.readyState === 1) return;
    isConnected = false;
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        heartbeatFrequencyMS: 15000,
    });
    isConnected = true;
    console.log('MongoDB Atlas conectado — customerreport_db');
}

mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('MongoDB desconectado');
});

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

// ── Previous rawdata (snapshot del import anterior para comparativas) ──
const PreviousRawdata = mongoose.models.PreviousRawdata || mongoose.model('PreviousRawdata',
    new mongoose.Schema(customerFields, { ...schemaOpts, collection: 'previousrawdata' })
);
const PreviousMeta = mongoose.models.PreviousMeta || mongoose.model('PreviousMeta',
    new mongoose.Schema({
        reportTitle: { type: String, default: '' },
        totalRecords: { type: Number, default: 0 },
        capturedAt:   { type: Date, default: Date.now },
        previousImportedAt: { type: Date, default: null },
    }, { ...schemaOpts, collection: 'previousmeta' })
);

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

// ── Schema: Users (NFC auth) ──
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    name:      { type: String, required: true },
    cardUID:   { type: String, required: true, unique: true },
    role:      { type: String, default: 'viewer', enum: ['admin', 'viewer'] },
    active:    { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: null },
}, { ...schemaOpts, collection: 'users' }));

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

        // Backup de rawdata ANTES de sobrescribir (para comparativa de reporte analista)
        const prevMeta = await Import.findOne().sort({ importedAt: -1 }).lean();
        const currentRawdata = await models.rawdata.find().lean();
        if (currentRawdata.length > 0) {
            await PreviousRawdata.deleteMany({});
            const clean = currentRawdata.map(r => { const { _id, ...rest } = r; return rest; });
            await PreviousRawdata.insertMany(clean, { ordered: false });
            await PreviousMeta.deleteMany({});
            await PreviousMeta.create({
                reportTitle: prevMeta ? (prevMeta.reportTitle || '') : '',
                totalRecords: currentRawdata.length,
                capturedAt: new Date(),
                previousImportedAt: prevMeta ? prevMeta.importedAt : null,
            });
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

// GET /api/previous-rawdata
app.get('/api/previous-rawdata', async (req, res) => {
    try {
        const data = await PreviousRawdata.find().lean();
        const meta = await PreviousMeta.findOne().sort({ capturedAt: -1 }).lean();
        res.json({ ok: true, count: data.length, data, meta });
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

// ══════════ AUTH ROUTES ══════════

// GET /api/auth/seed — Create admin user if no users exist
app.get('/api/auth/seed', async (req, res) => {
    try {
        const count = await User.countDocuments();
        if (count > 0) return res.json({ ok: false, error: 'Users already exist' });
        const admin = await User.create({
            name: 'Admin',
            cardUID: '04:AF:2D:D2:84:1C:90',
            role: 'admin',
        });
        res.json({ ok: true, user: { id: admin._id, name: admin.name, role: admin.role } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/auth/login — Login con tarjeta NFC
app.post('/api/auth/login', async (req, res) => {
    try {
        const { cardUID } = req.body;
        if (!cardUID) return res.status(400).json({ ok: false, error: 'Se requiere cardUID' });

        const normalized = cardUID.trim().toUpperCase();
        const user = await User.findOne({ cardUID: normalized, active: true });

        if (!user) {
            return res.status(401).json({ ok: false, error: 'Tarjeta no registrada' });
        }

        user.lastLogin = new Date();
        await user.save();

        res.json({
            ok: true,
            user: { id: user._id, name: user.name, role: user.role },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/auth/users — Listar usuarios (solo admin)
app.get('/api/auth/users', async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).lean();
        res.json({ ok: true, data: users.map(u => ({ ...u, cardUID: u.cardUID.slice(0, 8) + '...' })) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/auth/register — Registrar tarjeta nueva
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, cardUID, role } = req.body;
        if (!name || !cardUID) return res.status(400).json({ ok: false, error: 'Se requiere name y cardUID' });

        const normalized = cardUID.trim().toUpperCase();
        const exists = await User.findOne({ cardUID: normalized });
        if (exists) return res.status(409).json({ ok: false, error: 'Tarjeta ya registrada' });

        const user = await User.create({ name, cardUID: normalized, role: role || 'viewer' });
        res.json({ ok: true, user: { id: user._id, name: user.name, role: user.role } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE /api/auth/users/:id — Eliminar usuario
app.delete('/api/auth/users/:id', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = app;
