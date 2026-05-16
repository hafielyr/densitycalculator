/* Density Observer — IndexedDB layer (Dexie) */
const db = new Dexie('density_observer');

db.version(1).stores({
  observations: 'id, syncStatus, createdAt, segmentCode, surveyorId',
  config: 'key'
});

window.db = db;

const Config = {
  async get(key, fallback) {
    const row = await db.config.get(key);
    return row ? row.value : fallback;
  },
  async set(key, value) {
    await db.config.put({ key, value });
  }
};
window.Config = Config;
