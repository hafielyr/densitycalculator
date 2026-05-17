/* Density Observer — Alpine.js component & helpers */

const REMINDER_SECONDS = 30 * 60;
const PHOTO_TARGET_BYTES = 500 * 1024;
const PHOTO_MAX_DIM = 1600;

const DENSITY = [
  { code: 'L',  label: 'Loose',             factor: 0.3, color: '#22c55e', icon: '🟢' },
  { code: 'M',  label: 'Moderate',          factor: 1.0, color: '#84cc16', icon: '🟡' },
  { code: 'C',  label: 'Crowded',           factor: 2.5, color: '#f59e0b', icon: '🟠' },
  { code: 'D',  label: 'Dense',             factor: 4.0, color: '#ef4444', icon: '🔴' },
  { code: 'DG', label: 'Dangerously Dense', factor: 4.5, color: '#7f1d1d', icon: '⚠️' },
];

const WEATHER = [
  { code: 'cerah',         label: 'Cerah',        icon: '☀️' },
  { code: 'berawan',       label: 'Berawan',      icon: '☁️' },
  { code: 'hujan_ringan',  label: 'Hujan Ringan', icon: '🌧️' },
  { code: 'hujan_deras',   label: 'Hujan Deras',  icon: '⛈️' },
];

const INCIDENTS = [
  'Tidak ada insiden',
  'Jatuh/terinjak',
  'Overcrowding',
  'Cuaca ekstrem',
  'Gangguan listrik',
  'Lainnya'
];

const WIZARD_QUESTIONS = [
  'Apakah ada ruang kosong antar orang yang bisa dilewati?',
  'Apakah orang masih bisa bergerak tanpa menyentuh tetangga?',
  'Apakah bahu tidak menyentuh tetangga di kedua sisi?',
  'Apakah orang bisa angkat tangan, badan tidak saling tekan sehingga tangan bisa diangkat?'
];

// ----- helpers -----
function blankForm() {
  return {
    dimensions:  { width: null, length: null },
    timestamp: null,
    densityClasses: { d1: '', d2: '', d3: '', overall: '', overallOverridden: false },
    weather: '',
    photo: { dataUrl: '', timestamp: null, size: 0, error: '' },
    incident: { category: 'Tidak ada insiden', notes: '' },
    estimatedPeople: { manual: null, isOverridden: false },
    decisionTreePath: []
  };
}

function densityIndex(code) {
  return DENSITY.findIndex((d) => d.code === code);
}

function maxDensityCode(codes) {
  let best = '';
  let bestIdx = -1;
  for (const c of codes) {
    const idx = densityIndex(c);
    if (idx > bestIdx) { bestIdx = idx; best = c; }
  }
  return best;
}

function majorityDensityCode(codes) {
  const filled = codes.filter(Boolean);
  if (!filled.length) return '';
  const counts = {};
  for (const c of filled) counts[c] = (counts[c] || 0) + 1;
  let topCount = 0;
  for (const c in counts) if (counts[c] > topCount) topCount = counts[c];
  const winners = Object.keys(counts).filter((c) => counts[c] === topCount);
  if (winners.length === 1) return winners[0];
  // Tie (e.g., all three different, or 2 different with only 2 filled):
  // break ties by the higher severity — safer default.
  return maxDensityCode(winners);
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function dataUrlSize(dataUrl) {
  const i = dataUrl.indexOf(',');
  const base64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((base64.length * 3) / 4);
}

function formatMMSS(secs) {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function todayBounds() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date();   end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { naturalWidth: w, naturalHeight: h } = img;
        if (Math.max(w, h) > PHOTO_MAX_DIM) {
          const r = PHOTO_MAX_DIM / Math.max(w, h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', q);
        while (dataUrlSize(dataUrl) > PHOTO_TARGET_BYTES && q > 0.4) {
          q -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', q);
        }
        resolve({
          dataUrl,
          size: dataUrlSize(dataUrl),
          width: w, height: h,
          isLandscape: w >= h
        });
      };
      img.onerror = () => reject(new Error('Gagal memuat gambar'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = 'sine';
    g.gain.value = 0.001;
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start();
    setTimeout(() => { try { o.stop(); ctx.close(); } catch {} }, 700);
  } catch {}
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

function toCsv(rows) {
  const cols = [
    'id','timestamp','surveyorId','surveyorName','segmentCode',
    'zoneNo','zoneLokasi','mapsUrl',
    'width','length','area',
    'densityClass1','densityClass2','densityClass3','densityClassOverall',
    'densityFactor','estPeople','isOverridden',
    'weather','incidentCategory','incidentNotes',
    'decisionTreePath','syncStatus','createdAt'
  ];
  const pick = (r, c) => {
    switch (c) {
      case 'width':                return r.dimensions?.width ?? '';
      case 'length':               return r.dimensions?.length ?? '';
      case 'area':                 return r.dimensions?.area ?? '';
      case 'zoneNo':               return r.zone?.no ?? '';
      case 'zoneLokasi':           return r.zone?.lokasi ?? '';
      case 'mapsUrl':              return r.zone?.mapsUrl ?? '';
      case 'densityClass1':        return r.densityClasses?.d1 ?? '';
      case 'densityClass2':        return r.densityClasses?.d2 ?? '';
      case 'densityClass3':        return r.densityClasses?.d3 ?? '';
      case 'densityClassOverall':  return r.densityClasses?.overall ?? r.densityClass ?? '';
      case 'estPeople':            return r.estimatedPeople?.manual ?? r.estimatedPeople?.auto ?? '';
      case 'isOverridden':         return r.estimatedPeople?.isOverridden ? 'true' : 'false';
      case 'incidentCategory':     return r.incident?.category ?? '';
      case 'incidentNotes':        return r.incident?.notes ?? '';
      case 'decisionTreePath':     return (r.decisionTreePath || []).join('|');
      default:                     return r[c] ?? '';
    }
  };
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => esc(pick(r, c))).join(','));
  return [header, ...lines].join('\n');
}

// ----- Alpine component -----
function app() {
  return {
    // ---------- state ----------
    view: 'form',
    dark: false,
    online: navigator.onLine,
    submitting: false,
    dgAlert: false,

    densityClasses: DENSITY,
    weatherOptions: WEATHER,
    incidentCategories: INCIDENTS,

    session: {
      surveyorId: '',
      surveyorName: '',
      segmentCode: '',
      zoneNo: null,
      zoneLokasi: '',
      zoneLebar: null,
      zonePanjang: null,
      mapsUrl: ''
    },

    zonaInfo: { event: '', rute: '' },
    zonaList: [],

    config: {
      webhookUrl: 'https://script.google.com/macros/s/AKfycbygmyqsqRfdZcJedBHuZLYlKE3ctEY9_UGTUatoSOO2yoyu2nAoIS7RS8KOfvb2ousOMA/exec'
    },

    form: blankForm(),

    wizard: {
      open: false,
      step: 1,
      answers: [],
      questions: WIZARD_QUESTIONS,
      targetSlot: 'd1'
    },

    timer: { running: false, remaining: REMINDER_SECONDS, display: '30:00', alarm: false, _timeoutId: null },

    observations: [],
    stats: { count: 0, avgFactor: 0, totalPeople: 0, pending: 0 },
    toast: { show: false, message: '', _timeout: null },
    photoView: { open: false, dataUrl: '', title: '', filename: '' },

    // ---------- lifecycle ----------
    async init() {
      this._initDark();
      window.addEventListener('online',  () => {
        this.online = true;
        this._syncPending().catch(() => {});
      });
      window.addEventListener('offline', () => this.online = false);

      await this._loadConfig();
      await this._loadZonaMaps();
      await this._tryRequestNotificationPermission();
      this._registerSW();

      // Session restore
      const saved = await Config.get('session', null);
      if (saved && saved.surveyorId) {
        this.session = { ...this.session, ...saved };
        // Re-resolve zone-derived fields against the current zona_maps in case
        // panjang_m/lebar_m have been updated since the session was saved.
        const zona = this.findZonaById(this.session.surveyorId);
        if (zona) {
          this.session.zoneLebar   = zona.lebar_m;
          this.session.zonePanjang = zona.panjang_m;
        }
        this._applyZoneDimensions();
        this.view = 'form';
        this.startTimer();
      } else {
        this.view = 'settings';
      }

      this.timer.display = formatMMSS(this.timer.remaining);

      // Auto-retry pending uploads: on app start, then every 2 minutes
      this._syncPending().catch(() => {});
      this._syncIntervalId = setInterval(() => {
        this._syncPending().catch(() => {});
      }, 2 * 60 * 1000);
    },

    _blankForm() { return blankForm(); },

    _initDark() {
      const stored = localStorage.getItem('density:dark');
      this.dark = stored === '1'
        || (stored === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', this.dark);
    },

    toggleDark() {
      this.dark = !this.dark;
      document.documentElement.classList.toggle('dark', this.dark);
      localStorage.setItem('density:dark', this.dark ? '1' : '0');
    },

    async _registerSW() {
      if (!('serviceWorker' in navigator)) return;
      try { await navigator.serviceWorker.register('./sw.js'); }
      catch (e) { console.warn('SW register failed', e); }
    },

    async _tryRequestNotificationPermission() {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch {}
      }
    },

    // ---------- config ----------
    async _loadConfig() {
      const defaults = { ...this.config };
      const stored = await Config.get('config', null);
      if (stored) {
        this.config = { ...defaults, ...stored };
      }
      if (!this.config.webhookUrl) this.config.webhookUrl = defaults.webhookUrl;
    },

    async saveConfig() {
      await Config.set('config', {
        webhookUrl: this.config.webhookUrl
      });
    },

    async _loadZonaMaps() {
      try {
        const res = await fetch('./zona_maps.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('zona_maps.json fetch failed');
        const data = await res.json();
        this.zonaInfo = { event: data.event || '', rute: data.rute || '' };
        this.zonaList = (data.zona || []).map((z) => ({
          no: z.no,
          lokasi: z.lokasi || '',
          surveyor: z.surveyor || '',
          maps_url: z.maps_url || '',
          lebar_m: typeof z.lebar_m === 'number' ? z.lebar_m : null,
          panjang_m: typeof z.panjang_m === 'number' ? z.panjang_m : null,
          id: `zona-${z.no}`,
          segmentCode: `Z${String(z.no).padStart(2, '0')}`
        }));
        await Config.set('zona_maps_cache', { zonaInfo: this.zonaInfo, zonaList: this.zonaList });
      } catch (e) {
        const cached = await Config.get('zona_maps_cache', null);
        if (cached) {
          this.zonaInfo = cached.zonaInfo || this.zonaInfo;
          this.zonaList = cached.zonaList || [];
        } else {
          console.warn('zona_maps.json unavailable and no cache', e);
        }
      }
    },

    findZonaById(id) {
      return this.zonaList.find((z) => z.id === id) || null;
    },

    // ---------- session ----------
    sessionReady() {
      if (!this.session.surveyorId) return false;
      if (!this.session.segmentCode) return false;
      return true;
    },

    canStartSession() { return this.sessionReady(); },

    onSurveyorChange() {
      const zona = this.findZonaById(this.session.surveyorId);
      if (zona) {
        this.session.surveyorName = zona.surveyor;
        this.session.segmentCode  = zona.segmentCode;
        this.session.zoneNo       = zona.no;
        this.session.zoneLokasi   = zona.lokasi;
        this.session.zoneLebar    = zona.lebar_m;
        this.session.zonePanjang  = zona.panjang_m;
        this.session.mapsUrl      = zona.maps_url;
        this._applyZoneDimensions(true);
      } else {
        this.session.surveyorName = '';
        this.session.segmentCode  = '';
        this.session.zoneNo       = null;
        this.session.zoneLokasi   = '';
        this.session.zoneLebar    = null;
        this.session.zonePanjang  = null;
        this.session.mapsUrl      = '';
      }
    },

    _applyZoneDimensions(force) {
      if (this.session.zoneLebar != null && (force || this.form.dimensions.width == null)) {
        this.form.dimensions.width = this.session.zoneLebar;
      }
      if (this.session.zonePanjang != null && (force || this.form.dimensions.length == null)) {
        this.form.dimensions.length = this.session.zonePanjang;
      }
    },

    isUsingZoneDefaults() {
      return this.session.zoneLebar != null &&
             this.session.zonePanjang != null &&
             this.form.dimensions.width  === this.session.zoneLebar &&
             this.form.dimensions.length === this.session.zonePanjang;
    },

    openZoneMap() {
      if (!this.session.mapsUrl) {
        this._showToast('Link peta zona belum tersedia');
        return;
      }
      window.open(this.session.mapsUrl, '_blank', 'noopener');
    },

    async startSession() {
      await Config.set('session', {
        surveyorId: this.session.surveyorId,
        surveyorName: this.session.surveyorName,
        segmentCode: this.session.segmentCode,
        zoneNo: this.session.zoneNo,
        zoneLokasi: this.session.zoneLokasi,
        zoneLebar: this.session.zoneLebar,
        zonePanjang: this.session.zonePanjang,
        mapsUrl: this.session.mapsUrl
      });
      this.view = 'form';
      this.startTimer();
      this._showToast('Sesi dimulai');
    },

    // ---------- form helpers ----------
    area() {
      const w = +this.form.dimensions.width || 0;
      const l = +this.form.dimensions.length || 0;
      return w * l;
    },

    overallDensityCode() {
      const dc = this.form.densityClasses;
      if (dc.overallOverridden && dc.overall) return dc.overall;
      const auto = majorityDensityCode([dc.d1, dc.d2, dc.d3]);
      return auto || dc.overall || '';
    },

    estPeople() {
      const code = this.overallDensityCode();
      const cls = DENSITY.find((d) => d.code === code);
      const factor = cls ? cls.factor : 0;
      const auto = Math.round(this.area() * factor);
      const isOverridden = !!this.form.estimatedPeople.isOverridden;
      const manual = this.form.estimatedPeople.manual;
      return { value: isOverridden ? (manual ?? 0) : auto, auto, isOverridden };
    },

    setDensity(slot, code) {
      if (slot === 'overall') {
        this.form.densityClasses.overall = code;
        this.form.densityClasses.overallOverridden = true;
      } else {
        this.form.densityClasses[slot] = code;
        if (!this.form.densityClasses.overallOverridden) {
          this.form.densityClasses.overall = this.overallDensityCode();
        }
      }
      if (code === 'DG') this.dgAlert = true;
      if (this.overallDensityCode() === 'DG') this.dgAlert = true;
      if (navigator.vibrate) navigator.vibrate(20);
    },

    clearOverallOverride() {
      this.form.densityClasses.overallOverridden = false;
      this.form.densityClasses.overall = this.overallDensityCode();
    },

    densityLabel(code) {
      const c = DENSITY.find((d) => d.code === code);
      return c ? `${c.label} — ${c.factor} org/m²` : '';
    },

    densityColor(code) {
      const c = DENSITY.find((d) => d.code === code);
      return c ? c.color : '#64748b';
    },

    async onPhoto(ev) {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      try {
        const r = await compressImageFile(file);
        this.form.photo = {
          dataUrl: r.dataUrl,
          size: r.size,
          timestamp: new Date().toISOString(),
          error: r.isLandscape ? '' : 'Foto tidak landscape — putar perangkat dan ambil ulang.'
        };
        if (navigator.vibrate) navigator.vibrate(30);
      } catch (e) {
        this._showToast('Gagal memproses foto');
      } finally {
        ev.target.value = '';
      }
    },

    // ---------- decision tree ----------
    openWizard(slot) {
      this.wizard.open = true;
      this.wizard.step = 1;
      this.wizard.answers = [];
      this.wizard.targetSlot = slot || 'd1';
      this.form.decisionTreePath = [];
    },

    wizardAnswer(ans) {
      const step = this.wizard.step;
      this.wizard.answers.push(ans);
      this.form.decisionTreePath = this.wizard.answers.map((a, i) => `P${i + 1}:${a}`);
      const finish = (code) => {
        this.setDensity(this.wizard.targetSlot, code);
        this.wizard.open = false;
        const slotLabel = this.wizard.targetSlot === 'overall' ? 'keseluruhan' : this.wizard.targetSlot.replace('d','');
        this._showToast(`Densitas ${slotLabel}: ${code}`);
      };
      if (step === 1 && ans === 'Y') return finish('L');
      if (step === 2 && ans === 'Y') return finish('M');
      if (step === 3 && ans === 'Y') return finish('C');
      if (step === 4) return finish(ans === 'Y' ? 'D' : 'DG');
      this.wizard.step++;
    },

    wizardBack() {
      if (this.wizard.step <= 1) return;
      this.wizard.step--;
      this.wizard.answers.pop();
      this.form.decisionTreePath = this.wizard.answers.map((a, i) => `P${i + 1}:${a}`);
    },

    // ---------- validation + submit ----------
    validationErrors() {
      const e = [];
      const dc = this.form.densityClasses;
      if (!this.sessionReady())                  e.push('Pilih surveyor');
      if (!this.form.dimensions.width
       || !this.form.dimensions.length)          e.push('Lebar/Panjang area belum terisi');
      if (!dc.d1)                                e.push('Pilih Klasifikasi Densitas 1');
      if (!dc.d2)                                e.push('Pilih Klasifikasi Densitas 2');
      if (!dc.d3)                                e.push('Pilih Klasifikasi Densitas 3');
      if (!this.overallDensityCode())            e.push('Klasifikasi Densitas keseluruhan belum tersedia');
      if (!this.form.weather)                    e.push('Pilih kondisi cuaca');
      if (!this.form.photo.dataUrl)              e.push('Foto bukti belum diambil');
      return e;
    },

    canSubmit() { return this.validationErrors().length === 0; },

    async submit() {
      if (!this.canSubmit() || this.submitting) return;
      this.submitting = true;
      const now = new Date().toISOString();
      const overallCode = this.overallDensityCode();
      const cls = DENSITY.find((d) => d.code === overallCode);
      const area = this.area();
      const ep = this.estPeople();
      const dc = this.form.densityClasses;
      const record = {
        id: uuid(),
        surveyorId: this.session.surveyorId,
        surveyorName: this.session.surveyorName || this.session.surveyorId,
        segmentCode: this.session.segmentCode,
        zone: {
          no: this.session.zoneNo,
          lokasi: this.session.zoneLokasi,
          mapsUrl: this.session.mapsUrl
        },
        dimensions: {
          width: +this.form.dimensions.width,
          length: +this.form.dimensions.length,
          area: +area.toFixed(2)
        },
        timestamp: now,
        densityClass: overallCode,
        densityClasses: {
          d1: dc.d1,
          d2: dc.d2,
          d3: dc.d3,
          overall: overallCode,
          overallOverridden: !!dc.overallOverridden
        },
        densityFactor: cls ? cls.factor : 0,
        estimatedPeople: {
          auto: ep.auto,
          manual: ep.isOverridden ? (this.form.estimatedPeople.manual ?? 0) : null,
          isOverridden: ep.isOverridden
        },
        weather: this.form.weather,
        photo: { ...this.form.photo },
        incident: { ...this.form.incident },
        decisionTreePath: [...this.form.decisionTreePath],
        syncStatus: 'local',
        createdAt: now,
        updatedAt: now
      };
      try {
        await db.observations.put(record);
        this._showToast('Observasi tersimpan');
        // Reset form but keep session + reset reminder timer
        this.resetForm();
        this.startTimer();
        if (this.config.webhookUrl) this._syncOne(record).catch(() => {});
      } catch (e) {
        console.error(e);
        this._showToast('Gagal menyimpan');
      } finally {
        this.submitting = false;
      }
    },

    resetForm() {
      this.form = this._blankForm();
      this.dgAlert = false;
      this._applyZoneDimensions();
    },

    // ---------- timer ----------
    startTimer() {
      this._stopTick();
      this.timer.running = true;
      this.timer.alarm = false;
      this.timer.remaining = REMINDER_SECONDS;
      this.timer.display = formatMMSS(this.timer.remaining);
      this._tick();
    },

    stopTimer() {
      this._stopTick();
      this.timer.running = false;
      this.timer.alarm = false;
      this.timer.display = formatMMSS(REMINDER_SECONDS);
    },

    _stopTick() {
      if (this.timer._timeoutId) {
        clearTimeout(this.timer._timeoutId);
        this.timer._timeoutId = null;
      }
    },

    _tick() {
      if (!this.timer.running) return;
      this.timer.display = formatMMSS(this.timer.remaining);
      if (this.timer.remaining <= 0) {
        this._fireReminder();
        return;
      }
      this.timer.remaining -= 1;
      this.timer._timeoutId = setTimeout(() => this._tick(), 1000);
    },

    _fireReminder() {
      this.timer.running = false;
      this.timer.alarm = true;
      this.timer.display = '00:00';
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
      beep();
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Density Observer', {
            body: 'Saatnya membuat observasi baru.',
            icon: './icons/icon-192.png',
            tag: 'density-reminder',
            renotify: true
          });
        } catch {}
      }
      this._showToast('⏰ Saatnya observasi baru');
    },

    // ---------- list / stats / export ----------
    async goList() {
      this.view = 'list';
      await this.loadObservations();
    },

    async loadObservations() {
      const { start, end } = todayBounds();
      const all = await db.observations
        .where('createdAt').between(start, end, true, true)
        .reverse().sortBy('createdAt');
      this.observations = all;
      const count = all.length;
      const totalPeople = all.reduce((s, o) =>
        s + (o.estimatedPeople?.manual ?? o.estimatedPeople?.auto ?? 0), 0);
      const avgFactor = count
        ? all.reduce((s, o) => s + (o.densityFactor || 0), 0) / count
        : 0;
      const pending = all.filter((o) => o.syncStatus !== 'synced').length;
      this.stats = { count, avgFactor, totalPeople, pending };
    },

    async deleteObs(id) {
      if (!confirm('Hapus observasi ini?')) return;
      await db.observations.delete(id);
      await this.loadObservations();
      this._showToast('Dihapus');
    },

    viewPhoto(o) {
      if (!o?.photo?.dataUrl) return this._showToast('Foto tidak tersedia');
      this.photoView.dataUrl = o.photo.dataUrl;
      this.photoView.title = `${o.segmentCode} · ${o.surveyorName || o.surveyorId} · ${this.formatTime(o.timestamp)}`;
      this.photoView.filename = `foto-${o.segmentCode}-${(o.timestamp || '').replace(/[:.]/g, '-')}.jpg`;
      this.photoView.open = true;
    },

    closePhotoView() {
      this.photoView.open = false;
      this.photoView.dataUrl = '';
      this.photoView.title = '';
      this.photoView.filename = '';
    },

    downloadPhotoView() {
      if (!this.photoView.dataUrl) return;
      const a = document.createElement('a');
      a.href = this.photoView.dataUrl;
      a.download = this.photoView.filename || 'foto.jpg';
      document.body.appendChild(a); a.click();
      setTimeout(() => document.body.removeChild(a), 200);
    },

    async exportJson() {
      const all = await db.observations.toArray();
      downloadFile(`observasi-${Date.now()}.json`, JSON.stringify(all, null, 2), 'application/json');
    },

    async exportCsv() {
      const all = await db.observations.toArray();
      // Strip dataUrl from CSV export to keep it small/readable
      const slim = all.map((o) => ({ ...o, photo: { ...o.photo, dataUrl: o.photo?.dataUrl ? '[binary]' : '' } }));
      downloadFile(`observasi-${Date.now()}.csv`, toCsv(slim), 'text/csv');
    },

    async syncAll() {
      if (!this.config.webhookUrl) return this._showToast('URL Apps Script belum diset');
      if (!navigator.onLine)        return this._showToast('Sedang offline');
      await this._syncPending({ toast: true });
    },

    _payloadFor(record) {
      // Photo stays local; strip dataUrl before sending to the database
      const { photo, ...rest } = record;
      return {
        ...rest,
        photo: photo ? {
          size: photo.size || 0,
          timestamp: photo.timestamp || '',
          hasImage: !!photo.dataUrl
        } : { hasImage: false }
      };
    },

    async _syncOne(record) {
      if (!this.config.webhookUrl) return false;
      try {
        await db.observations.update(record.id, { syncStatus: 'pending' });
        // text/plain avoids the CORS preflight that Apps Script web apps reject
        const res = await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(this._payloadFor(record)),
          redirect: 'follow'
        });
        if (res.ok) {
          let okFromBody = true;
          try {
            const txt = await res.text();
            if (txt && txt.trim().startsWith('{')) {
              const j = JSON.parse(txt);
              if (j && j.ok === false) okFromBody = false;
            }
          } catch {}
          if (okFromBody) {
            await db.observations.update(record.id, {
              syncStatus: 'synced',
              updatedAt: new Date().toISOString()
            });
            return true;
          }
        }
        await db.observations.update(record.id, { syncStatus: 'local' });
        return false;
      } catch {
        try { await db.observations.update(record.id, { syncStatus: 'local' }); } catch {}
        return false;
      }
    },

    async _syncPending(opts) {
      if (!this.config.webhookUrl) return { ok: 0, fail: 0, skipped: true };
      if (!navigator.onLine) return { ok: 0, fail: 0, skipped: true };
      if (this._syncing) return { ok: 0, fail: 0, skipped: true };
      this._syncing = true;
      try {
        const pending = await db.observations
          .filter((o) => o.syncStatus !== 'synced').toArray();
        let ok = 0, fail = 0;
        for (const o of pending) {
          const success = await this._syncOne(o);
          success ? ok++ : fail++;
        }
        if (this.view === 'list') await this.loadObservations();
        if (opts && opts.toast && (ok || fail)) {
          this._showToast(`Sync: ${ok} ok, ${fail} gagal`);
        }
        return { ok, fail };
      } finally {
        this._syncing = false;
      }
    },

    reportToCoordinator() {
      // Simulate alert — if a webhook is configured, send a marker payload
      const payload = {
        type: 'COORDINATOR_ALERT',
        surveyorId: this.session.surveyorId,
        surveyorName: this.session.surveyorName,
        segmentCode: this.session.segmentCode,
        timestamp: new Date().toISOString()
      };
      if (this.config.webhookUrl) {
        fetch(this.config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }
      if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
      this._showToast('Alert coordinator dikirim');
    },

    // ---------- formatting helpers used in templates ----------
    formatBytes(b) {
      if (!b) return '';
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    },

    formatTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      } catch { return iso; }
    },

    syncBadgeClass(s) {
      if (s === 'synced')  return 'bg-blue-100 text-blue-700  dark:bg-blue-900/40  dark:text-blue-300';
      if (s === 'pending') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    },

    syncBadgeText(s) {
      if (s === 'synced')  return '🔵 sync';
      if (s === 'pending') return '🟠 menunggu';
      return '🟢 lokal';
    },

    _showToast(message) {
      this.toast.message = message;
      this.toast.show = true;
      if (this.toast._timeout) clearTimeout(this.toast._timeout);
      this.toast._timeout = setTimeout(() => { this.toast.show = false; }, 2200);
    }
  };
}
window.app = app;
