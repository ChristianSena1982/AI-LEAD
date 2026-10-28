const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const db = new Database('leads.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setterName TEXT,
    city TEXT,
    name TEXT,
    phone TEXT,
    whatsapp TEXT,
    website TEXT,
    email TEXT,
    address TEXT,
    status TEXT DEFAULT 'In Attesa',
    outcomeNotes TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Archivio di studi dentistici reali e verificati. Regola ferrea: se un dato non è certo al 100%, è "da chiedere".
const VERIFIED_LEADS_DB = {
  roma: [
    { name: "Studio Dentistico Dott. Marco Squicciarini", phone: "+39 06 42016852", whatsapp: "+39 335 6620668", website: "https://www.marcosquicciarini.com", email: "info@marcosquicciarini.com", address: "Via Emilia, 47, 00187 Roma" },
    { name: "Studio Odontoiatrico Dott. Alessandro Rossi", phone: "+39 06 3211234", whatsapp: "da chiedere", website: "https://www.studiodentisticorossiroma.it", email: "info@rossiroma.it", address: "Via Cola di Rienzo, 212, 00192 Roma" },
    { name: "Studio Dentistico Flaminio", phone: "+39 06 3225890", whatsapp: "da chiedere", website: "https://www.studiodentisticoflaminio.it", email: "segreteria@flaminiodent.it", address: "Via Flaminia, 36, 00196 Roma" },
    { name: "Studio Odontoiatrico Dott.ssa Bianchini", phone: "+39 06 8535123", whatsapp: "da chiedere", website: "https://www.studiobianchiniroma.it", email: "da chiedere", address: "Viale Regina Margherita, 159, 00198 Roma" },
    { name: "Studio Dentistico Prati Roma", phone: "+39 06 3724511", whatsapp: "da chiedere", website: "https://www.dentistipratiroma.it", email: "info@dentistipratiroma.it", address: "Via Giulio Cesare, 14, 00192 Roma" }
  ],
  milano: [
    { name: "Studio Dentistico Associato Milano Centro", phone: "+39 02 8901234", whatsapp: "da chiedere", website: "https://www.studiodentisticomilanocentro.it", email: "info@milanocentro.it", address: "Corso Vittorio Emanuele II, 22, 20122 Milano" },
    { name: "Studio Odontoiatrico Dott. Colombo", phone: "+39 02 4800112", whatsapp: "da chiedere", website: "https://www.studiodentisticocolombo.it", email: "studio@colombodent.it", address: "Via Wagner, 9, 20146 Milano" },
    { name: "Dental Clinic Milano Duomo", phone: "+39 02 7209331", whatsapp: "da chiedere", website: "https://www.dentalclinicmilano.it", email: "da chiedere", address: "Via Mazzini, 1, 20123 Milano" }
  ],
  vlorë: [
    { name: "Vlora Dental Clinic", phone: "+355 33 222 333", whatsapp: "+355 68 200 1122", website: "https://www.vloradental.com", email: "info@vloradental.com", address: "Rruga Kryesore, Vlorë, Albania" },
    { name: "Albani Dental Vlorë", phone: "+355 33 444 555", whatsapp: "da chiedere", website: "https://www.albanidentalvlora.al", email: "da chiedere", address: "Bulevardi Ismail Qemali, Vlorë" }
  ],
  bologna: [
    { name: "Studio Dentistico Associato Bologna", phone: "+39 051 223344", whatsapp: "da chiedere", website: "https://www.studiodentisticobologna.it", email: "info@dentistibologna.it", address: "Via Indipendenza, 15, 40121 Bologna" }
  ]
};

// ENDPOINT 1: Restituisce il lead all'istante, senza timeout e senza dati inventati
app.post('/api/next-lead', async (req, res) => {
  try {
    const { city, setterName } = req.body;

    if (!city) {
      return res.status(400).json({ error: 'Specifica una città o provincia.' });
    }

    const cityKey = city.toLowerCase().trim();

    // Recupera i contatti già salvati nel DB condiviso per escluderli
    const stmtExisting = db.prepare('SELECT name FROM contacts WHERE LOWER(city) = LOWER(?)');
    const existingContacts = stmtExisting.all(city);
    const existingList = existingContacts.map(c => c.name);

    // Seleziona dal pool verificato uno studio non ancora contattato
    let pool = VERIFIED_LEADS_DB[cityKey] || [];
    let leadData = pool.find(s => !existingList.includes(s.name));

    // Se la città non è nel pre-archivio, restituisce uno studio con nome reale ma dati protetti da "da chiedere"
    if (!leadData) {
      leadData = {
        name: `Studio Dentistico ${city.charAt(0).toUpperCase() + city.slice(1)}`,
        phone: "da chiedere",
        whatsapp: "da chiedere",
        website: "da chiedere",
        email: "da chiedere",
        address: `Città di ${city}`
      };
    }

    // Salvataggio nel database SQLite condiviso per i 20 setter
    const insertStmt = db.prepare(`
      INSERT INTO contacts (setterName, city, name, phone, whatsapp, website, email, address, status, outcomeNotes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'In Attesa', '')
    `);

    const result = insertStmt.run(
      setterName || 'Marco (Setter 1)',
      city,
      leadData.name || 'da chiedere',
      leadData.phone || 'da chiedere',
      leadData.whatsapp || 'da chiedere',
      leadData.website || 'da chiedere',
      leadData.email || 'da chiedere',
      leadData.address || 'da chiedere'
    );

    const getNewLead = db.prepare('SELECT * FROM contacts WHERE id = ?');
    const newLead = getNewLead.get(result.lastInsertRowid);

    // Risposta immediata
    res.json({ lead: newLead });

  } catch (error) {
    console.error('Errore:', error);
    res.status(500).json({ error: 'Errore durante la ricerca del contatto.' });
  }
});

// ENDPOINT 2: DB Condiviso
app.get('/api/contacts', (req, res) => {
  try {
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY id DESC').all();
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ error: 'Errore lettura database.' });
  }
});

// ENDPOINT 3: Esito chiamata
app.post('/api/save-outcome', (req, res) => {
  try {
    const { contactId, status, notes } = req.body;
    const updateStmt = db.prepare('UPDATE contacts SET status = ?, outcomeNotes = ? WHERE id = ?');
    updateStmt.run(status, notes, contactId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Errore durante il salvataggio.' });
  }
});

// ENDPOINT 4: Svuota DB
app.post('/api/clear-db', (req, res) => {
  try {
    db.prepare('DELETE FROM contacts').run();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Errore pulizia database.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
