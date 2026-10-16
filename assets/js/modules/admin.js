// Admin module - Handles admin functionality (Exception Days, Weather Stations, Users)

const AdminModule = {
    // Current data
    holidayDefinitions: [],
    referenceDays: [],   // reference day definitions [{id, name, description}]
    easterDates: [],     // computed Easter dates [{year, easter_date}] (separate list:
                         // both used to share referenceDays, last loader won)
    weatherStations: [],
    users: [],

    // Davenport terrain roughness classes (z0 in m) for the wind-profile transfer.
    // See docs/WIND_CORRECTION.md.
    ROUGHNESS_CLASSES: [
        { z0: 0.0002, label: 'Water / ice (0.0002)' },
        { z0: 0.005,  label: 'Open sea, smooth (0.005)' },
        { z0: 0.03,   label: 'Open flat — grass, few obstacles (0.03)' },
        { z0: 0.10,   label: 'Farmland, low crops (0.10)' },
        { z0: 0.30,   label: 'Suburban — scattered buildings & trees (0.30)' },
        { z0: 0.50,   label: 'Urban / dense (0.50)' }
    ],

    // Build <option>s for a roughness selector. Blank first option = no default;
    // a terrain class must be chosen. selectedZ0 matches within tolerance.
    roughnessOptionsHtml: function(selectedZ0) {
        const sel = (selectedZ0 !== null && selectedZ0 !== undefined && selectedZ0 !== '')
            ? parseFloat(selectedZ0) : null;
        let html = `<option value="">-- Select terrain --</option>`;
        let matched = false;
        this.ROUGHNESS_CLASSES.forEach(c => {
            const isSel = sel !== null && Math.abs(sel - c.z0) < 1e-6;
            if (isSel) matched = true;
            html += `<option value="${c.z0}" ${isSel ? 'selected' : ''}>${c.label}</option>`;
        });
        // Surface a stored value that maps to no class (legacy value, or one
        // truncated by an un-widened DECIMAL column — e.g. 0.0002 -> 0.000 before
        // migration 033) so it's visible instead of a silent blank.
        if (sel !== null && Number.isFinite(sel) && !matched) {
            html += `<option value="${sel}" selected>Current: ${sel} (not a standard class)</option>`;
        }
        return html;
    },

    // Does a station have a valid wind config (height + roughness)?
    stationWindConfigured: function(station) {
        if (!station) return false;
        const h = parseFloat(station.measurement_height_wind);
        const z0 = parseFloat(station.terrain_roughness);
        return Number.isFinite(h) && h > 0 && Number.isFinite(z0) && z0 > 0;
    },

    // Render a location map for the selected station (self-contained OSM embed,
    // so it doesn't depend on the project module being loaded). Terrain-level
    // zoom; longitude window widens toward the poles to stay roughly square.
    renderStationMap: function(lat, lng) {
        const el = document.getElementById('station-map');
        if (!el) return;
        const la = parseFloat(lat), lo = parseFloat(lng);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) {
            el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--neutral-400);font-size:12px;">No coordinates</div>';
            return;
        }
        const dLat = 0.06;
        const cos = Math.max(Math.cos(la * Math.PI / 180), 0.15);
        const dLng = dLat / cos;
        const bbox = `${lo - dLng},${la - dLat},${lo + dLng},${la + dLat}`;
        const url = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${la},${lo}`;
        el.innerHTML = `<iframe title="Station location" src="${url}" style="width:100%;height:100%;border:none;" loading="lazy"></iframe>`;
    },

    // Initialize admin module
    init: function() {
        console.log('Admin module initialized');
    },

    // ========================================
    // EXCEPTION DAY DEFINITIONS
    // ========================================

    loadHolidayDefinitions: async function() {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_holiday_definitions');
            const data = await response.json();

            if (data.definitions) {
                this.holidayDefinitions = data.definitions;
                this.referenceDays = data.reference_days || [];
                this.renderHolidayDefinitions();
            }
        } catch (err) {
            console.error('Failed to load holiday definitions:', err);
            document.getElementById('holiday-definitions-list').innerHTML =
                '<p class="error">Failed to load holiday definitions</p>';
        }
    },

    renderHolidayDefinitions: function() {
        const container = document.getElementById('holiday-definitions-list');
        if (!container) return;

        if (this.holidayDefinitions.length === 0) {
            container.innerHTML = '<p class="text-muted">No exception days defined</p>';
            return;
        }

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Name</th><th>Type</th><th>Date/Offset</th><th></th>' +
            '</tr></thead><tbody>';

        this.holidayDefinitions.forEach(def => {
            const isFixed = parseInt(def.is_fixed) === 1;
            const dateValue = isFixed
                ? `${String(def.fixed_month || 1).padStart(2,'0')}-${String(def.fixed_day || 1).padStart(2,'0')}`
                : (def.offset_days || 0);

            // Reference day dropdown options
            const refOptions = this.referenceDays.map(rd =>
                `<option value="${escapeHtml(rd.id)}" ${rd.id == def.reference_day_id ? 'selected' : ''}>${escapeHtml(rd.name)}</option>`
            ).join('');

            html += `<tr data-id="${escapeHtml(def.id)}">
                <td><input type="text" class="inline-edit" value="${escapeHtml(def.name || '')}"
                    onchange="app.admin.updateHolidayField(${escapeJsArg(def.id)}, 'name', this.value)"></td>
                <td><select class="inline-edit" onchange="app.admin.updateHolidayType(${escapeJsArg(def.id)}, this.value)">
                    <option value="fixed" ${isFixed ? 'selected' : ''}>Fixed</option>
                    <option value="relative" ${!isFixed ? 'selected' : ''}>Relative</option>
                </select></td>
                <td>${isFixed
                    ? `<input type="date" class="inline-edit" value="2000-${escapeHtml(dateValue)}"
                        onchange="app.admin.updateHolidayDate(${escapeJsArg(def.id)}, this.value)">`
                    : `<input type="number" class="inline-edit" style="width:50px" value="${escapeHtml(def.offset_days || 0)}"
                        onchange="app.admin.updateHolidayField(${escapeJsArg(def.id)}, 'offset_days', this.value)">
                       <span style="margin:0 4px">days from</span>
                       <select class="inline-edit" onchange="app.admin.updateHolidayField(${escapeJsArg(def.id)}, 'reference_day_id', this.value)">
                        ${refOptions}
                       </select>`
                }</td>
                <td><button class="btn btn-xs btn-danger" onclick="app.admin.deleteHolidayDefinition(${escapeJsArg(def.id)})" title="Delete">×</button></td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    updateHolidayField: async function(id, field, value) {
        const def = this.holidayDefinitions.find(d => String(d.id) === String(id));
        if (!def) return;
        def[field] = value;
        await this.saveHolidayInline(def);
    },

    updateHolidayType: async function(id, type) {
        const def = this.holidayDefinitions.find(d => String(d.id) === String(id));
        if (!def) return;
        def.is_fixed = type === 'fixed' ? 1 : 0;
        // Set defaults based on type
        if (def.is_fixed == 1) {
            def.reference_day_id = null;
            def.offset_days = null;
            if (!def.fixed_month) def.fixed_month = 1;
            if (!def.fixed_day) def.fixed_day = 1;
        } else {
            def.fixed_month = null;
            def.fixed_day = null;
            if (!def.reference_day_id && this.referenceDays.length > 0) {
                def.reference_day_id = this.referenceDays[0].id;
            }
            if (def.offset_days === null) def.offset_days = 0;
        }
        if (await this.saveHolidayInline(def)) {
            this.renderHolidayDefinitions(); // Re-render to show correct fields
        }
    },

    updateHolidayDate: async function(id, dateValue) {
        const def = this.holidayDefinitions.find(d => String(d.id) === String(id));
        if (!def) return;
        // dateValue is like "2000-05-17", extract month and day
        const parts = dateValue.split('-');
        def.fixed_month = parseInt(parts[1]);
        def.fixed_day = parseInt(parts[2]);
        await this.saveHolidayInline(def);
    },

    saveHolidayInline: async function(def) {
        try {
            const response = await fetch('./api/heataq_api.php?action=save_holiday_definition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: def.id,
                    name: def.name,
                    is_fixed: def.is_fixed,
                    fixed_month: def.fixed_month,
                    fixed_day: def.fixed_day,
                    reference_day_id: def.reference_day_id,
                    offset_days: def.offset_days
                })
            });
            const result = await response.json().catch(() => ({ error: `Server returned HTTP ${response.status}` }));
            if (!result.success) {
                throw new Error(result.error || 'Unknown error');
            }
            return true;
        } catch (err) {
            // The row was already changed locally: say so and reload the
            // saved definitions so it reverts to what the server has.
            console.error('Failed to save:', err);
            alert(`Could not save "${def.name}": ${err.message}`);
            await this.loadHolidayDefinitions();
            return false;
        }
    },

    addHolidayDefinition: function() {
        this.showHolidayForm(null);
    },

    editHolidayDefinition: function(id) {
        const def = this.holidayDefinitions.find(d => String(d.id) === String(id));
        if (def) {
            this.showHolidayForm(def);
        }
    },

    showHolidayForm: function(existingDef) {
        const isEdit = !!existingDef;
        const title = isEdit ? 'Edit Exception Day' : 'Add Exception Day';
        const isFixed = existingDef ? parseInt(existingDef.is_fixed) === 1 : true;

        // Reference day dropdown options
        const refOptions = this.referenceDays.map(rd =>
            `<option value="${escapeHtml(rd.id)}" ${rd.id == existingDef?.reference_day_id ? 'selected' : ''}>${escapeHtml(rd.name)}</option>`
        ).join('');

        const html = `
            <div class="modal-overlay" onclick="app.admin.closeHolidayForm()">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <h3>${title}</h3>
                    <form id="holiday-form">
                        <input type="hidden" id="holiday-id" value="${escapeHtml(existingDef?.id || '')}">

                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="holiday-name" class="form-control" required
                                value="${escapeHtml(existingDef?.name || '')}" placeholder="e.g., Langfredag">
                        </div>

                        <div class="form-group">
                            <label>Type</label>
                            <select id="holiday-type" class="form-control" onchange="app.admin.toggleHolidayType()">
                                <option value="fixed" ${isFixed ? 'selected' : ''}>Fixed Date</option>
                                <option value="relative" ${!isFixed ? 'selected' : ''}>Relative to Reference Day</option>
                            </select>
                        </div>

                        <div id="fixed-date-fields" style="${!isFixed ? 'display:none' : ''}">
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Day</label>
                                    <input type="number" id="holiday-day" class="form-control" min="1" max="31"
                                        value="${escapeHtml(existingDef?.fixed_day || 1)}">
                                </div>
                                <div class="form-group">
                                    <label>Month</label>
                                    <input type="number" id="holiday-month" class="form-control" min="1" max="12"
                                        value="${escapeHtml(existingDef?.fixed_month || 1)}">
                                </div>
                            </div>
                        </div>

                        <div id="relative-date-fields" style="${isFixed ? 'display:none' : ''}">
                            <div class="form-group">
                                <label>Reference Day</label>
                                <select id="holiday-reference" class="form-control">
                                    ${refOptions}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Offset (days)</label>
                                <input type="number" id="holiday-offset" class="form-control" min="-100" max="100"
                                    value="${escapeHtml(existingDef?.offset_days || 0)}">
                                <small class="text-muted">Negative = before, Positive = after. E.g., -2 for Good Friday</small>
                            </div>
                        </div>

                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" onclick="app.admin.closeHolidayForm()">Cancel</button>
                            <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        // Add modal to page
        const modalDiv = document.createElement('div');
        modalDiv.id = 'holiday-modal';
        modalDiv.innerHTML = html;
        document.body.appendChild(modalDiv);

        // Setup form submission
        document.getElementById('holiday-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveHolidayDefinition();
        });
    },

    toggleHolidayType: function() {
        const type = document.getElementById('holiday-type').value;
        document.getElementById('fixed-date-fields').style.display = type === 'fixed' ? '' : 'none';
        document.getElementById('relative-date-fields').style.display = type === 'relative' ? '' : 'none';
    },

    closeHolidayForm: function() {
        const modal = document.getElementById('holiday-modal');
        if (modal) modal.remove();
    },

    saveHolidayDefinition: async function() {
        const id = document.getElementById('holiday-id').value;
        const name = document.getElementById('holiday-name').value;
        const type = document.getElementById('holiday-type').value;
        const isFixed = type === 'fixed';

        const data = {
            action: 'save_holiday_definition',
            id: id || null,
            name: name,
            is_fixed: isFixed ? 1 : 0,
            fixed_day: isFixed ? parseInt(document.getElementById('holiday-day').value) : null,
            fixed_month: isFixed ? parseInt(document.getElementById('holiday-month').value) : null,
            reference_day_id: !isFixed ? parseInt(document.getElementById('holiday-reference').value) : null,
            offset_days: !isFixed ? parseInt(document.getElementById('holiday-offset').value) : null
        };

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();

            if (result.success) {
                this.closeHolidayForm();
                this.loadHolidayDefinitions();
            } else {
                alert('Failed to save: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Failed to save exception day:', err);
            alert('Failed to save exception day');
        }
    },

    deleteHolidayDefinition: async function(id) {
        if (!confirm('Delete this exception day?')) return;

        try {
            const response = await fetch(`./api/heataq_api.php?action=delete_holiday_definition&id=${encodeURIComponent(id)}`, { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                this.loadHolidayDefinitions();
            } else {
                let msg = result.error || 'Unknown error';
                if (msg.includes('foreign key') || msg.includes('constraint')) {
                    msg = 'Cannot delete: This exception day is used in calendar rules.\nRemove it from calendar rules first.';
                }
                alert(msg);
            }
        } catch (err) {
            console.error('Failed to delete exception day:', err);
            alert('Failed to delete exception day');
        }
    },

    loadReferenceDays: async function() {
        try {
            const response = await fetch('./api/heataq_api.php?action=get_reference_days');
            const data = await response.json();

            if (data.reference_days) {
                this.easterDates = data.reference_days;
                this.renderReferenceDays();
            }
        } catch (err) {
            console.error('Failed to load reference days:', err);
        }
    },

    renderReferenceDays: function() {
        const container = document.getElementById('reference-days-list');
        if (!container) return;

        if (this.easterDates.length === 0) {
            container.innerHTML = '<p class="text-muted">No reference days</p>';
            return;
        }

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Year</th><th>1. påskedag</th>' +
            '</tr></thead><tbody>';

        this.easterDates.forEach(ref => {
            html += `<tr>
                <td>${escapeHtml(ref.year)}</td>
                <td>${escapeHtml(ref.easter_date)}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    // ========================================
    // WEATHER STATIONS
    // ========================================

    selectedStationId: '',

    loadWeatherStations: async function() {
        try {
            // Load stations first
            const stationsRes = await fetch('./api/heataq_api.php?action=get_weather_stations');
            const stationsData = await stationsRes.json();

            if (stationsData.error) {
                console.error('Weather stations API error:', stationsData.error);
                document.getElementById('weather-stations-list').innerHTML =
                    `<p class="error">Error: ${escapeHtml(stationsData.error)}</p>`;
                return;
            }

            if (stationsData.stations) {
                this.weatherStations = stationsData.stations;
                this.renderWeatherStations();
                this.populateStationDropdown();
                this.loadForecastStatus();
                this.initForecastFetch();

                // The dropdown was rebuilt: keep the selected station if it
                // still exists, else default to the station linked to the open
                // project's site. If neither exists (e.g. the selected station
                // was just deleted), clear the selection and its details, so
                // nothing keeps pointing at a station that is gone.
                const select = document.getElementById('weather-station-select');
                const exists = id => id && this.weatherStations.some(s => s.station_id === id);
                const projStation = (typeof ProjectModule !== 'undefined')
                    ? ProjectModule.currentSite?.weather_station_id : null;
                if (select) {
                    const previous = this.selectedStationId;
                    const next = exists(previous) ? previous : (exists(projStation) ? projStation : '');
                    select.value = next;
                    if (next !== previous || next === '') {
                        await this.onStationChange();
                    }
                }
            }
        } catch (err) {
            console.error('Failed to load weather stations:', err);
            const container = document.getElementById('weather-stations-list');
            if (container) {
                container.innerHTML = '<p class="error">Failed to load weather stations</p>';
            }
        }
    },

    // ---- Weather forecasts (scripts/forecast/fetch_met_nordic.py) ----

    loadForecastStatus: async function() {
        const el = document.getElementById('forecast-status');
        if (!el) return;
        try {
            const res = await fetch('./api/heataq_api.php?action=get_forecast_status');
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            if (!data.installed) {
                el.innerHTML = '<p class="text-muted">Not available yet: run migration 042 (System &rarr; Database Migrations).</p>';
                return;
            }
            if (!data.status.length) {
                el.innerHTML = '<p class="text-muted">No forecasts imported yet.</p>';
                return;
            }
            const name = id => (this.weatherStations || []).find(s => s.station_id === id)?.name || id;
            const day = ts => (ts || '').slice(0, 10);
            el.innerHTML = `<table class="data-table compact" style="max-width: 700px;">
                <thead><tr><th>Station</th><th>Source</th><th>Runs</th><th>First run</th><th>Last run</th></tr></thead>
                <tbody>${data.status.map(r => `<tr>
                    <td>${escapeHtml(name(r.station_id))}</td>
                    <td>${escapeHtml(r.source)}</td>
                    <td style="text-align: right;">${Number(r.runs).toLocaleString()}</td>
                    <td>${escapeHtml(day(r.first_issued))}</td>
                    <td>${escapeHtml(day(r.last_issued))}</td>
                </tr>`).join('')}</tbody></table>`;
        } catch (err) {
            el.innerHTML = `<p class="error">Could not read forecast status: ${escapeHtml(err.message)}</p>`;
        }
    },

    // ---- Fetch from MET Norway on the server, day by day ----

    /** Fill the station list and default dates (once), then preview. */
    initForecastFetch: function() {
        const sel = document.getElementById('forecast-station');
        if (!sel) return;
        const stations = (this.weatherStations || []).filter(s => s.latitude && s.longitude);
        const previous = sel.value;
        sel.innerHTML = stations.map(s =>
            `<option value="${escapeHtml(s.station_id)}">${escapeHtml(s.name)}</option>`).join('');
        const projStation = (typeof ProjectModule !== 'undefined') ? ProjectModule.currentSite?.weather_station_id : null;
        const pick = [previous, projStation].find(id => id && stations.some(s => s.station_id === id));
        if (pick) sel.value = pick;
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const from = document.getElementById('forecast-from');
        const to = document.getElementById('forecast-to');
        if (from && !from.value) from.value = '2019-11-28';
        if (to && !to.value) to.value = yesterday;
        if (from) { from.min = '2019-11-28'; from.max = yesterday; }
        if (to) { to.min = '2019-11-28'; to.max = yesterday; }
        this.planForecastFetch();
    },

    /** Days of the chosen period that still lack runs (4 per day). */
    forecastDaysToFetch: async function() {
        const station = document.getElementById('forecast-station')?.value;
        const from = document.getElementById('forecast-from')?.value;
        const to = document.getElementById('forecast-to')?.value;
        if (!station || !from || !to || to < from) return null;
        const q = new URLSearchParams({ action: 'get_forecast_days', station_id: station, from, to });
        const data = await (await fetch(`./api/heataq_api.php?${q}`)).json();
        if (data.error) throw new Error(data.error);
        const have = data.days || {};
        const days = [];
        for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
            const iso = d.toISOString().slice(0, 10);
            if ((have[iso] || 0) < 4) days.push(iso);
        }
        return { station, days };
    },

    planForecastFetch: async function() {
        const el = document.getElementById('forecast-fetch-progress');
        if (!el || this._forecastFetching) return;
        try {
            const plan = await this.forecastDaysToFetch();
            if (!plan) { el.textContent = ''; return; }
            el.style.color = '#666';
            el.textContent = plan.days.length
                ? `${plan.days.length.toLocaleString()} day(s) to fetch (about ${Math.max(1, Math.round(plan.days.length * 10 / 60))} min with this page open; can be stopped and resumed).`
                : 'All days of this period are fetched.';
        } catch (err) {
            el.style.color = '#dc3545';
            el.textContent = err.message;
        }
    },

    stopForecastFetch: function() {
        this._forecastStop = true;
    },

    /**
     * Fetch the missing days: the server reads each day's 4 runs from MET
     * Norway's archive and stores them. 3 days at a time; resumable.
     */
    fetchForecasts: async function() {
        const el = document.getElementById('forecast-fetch-progress');
        const btn = document.getElementById('forecast-fetch-btn');
        const stopBtn = document.getElementById('forecast-stop-btn');
        let plan;
        try {
            plan = await this.forecastDaysToFetch();
        } catch (err) {
            el.style.color = '#dc3545';
            el.textContent = err.message;
            return;
        }
        if (!plan || !plan.days.length) { this.planForecastFetch(); return; }

        this._forecastFetching = true;
        this._forecastStop = false;
        btn.disabled = true;
        stopBtn.style.display = 'inline-block';
        const days = plan.days.slice();
        const total = days.length;
        let done = 0, runs = 0, missing = 0, failures = 0, lastError = '';
        const t0 = Date.now();
        const show = () => {
            const rate = done / Math.max(1, (Date.now() - t0) / 1000);
            const left = rate > 0 ? Math.round((total - done) / rate / 60) : '?';
            el.style.color = '#666';
            el.textContent = `Fetching: ${done.toLocaleString()} / ${total.toLocaleString()} days, ${runs.toLocaleString()} runs`
                + (missing ? `, ${missing} run(s) not in the archive` : '') + ` (about ${left} min left)`;
        };
        const worker = async () => {
            while (days.length && !this._forecastStop && failures < 3) {
                const date = days.shift();
                try {
                    const res = await fetch('./api/heataq_api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'fetch_forecasts_day', station_id: plan.station, date })
                    });
                    const data = await res.json();
                    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                    runs += data.runs;
                    missing += (data.missing || []).length;
                    failures = 0;
                } catch (err) {
                    failures++;
                    lastError = err.message;
                    days.push(date);   // try again later in this pass
                    continue;
                }
                done++;
                show();
            }
        };
        show();
        await Promise.all([worker(), worker(), worker()]);
        this._forecastFetching = false;
        btn.disabled = false;
        stopBtn.style.display = 'none';
        if (failures >= 3) {
            el.style.color = '#dc3545';
            el.textContent = `Stopped after repeated errors: ${lastError} (${done} days fetched; press Fetch to continue).`;
        } else {
            el.style.color = this._forecastStop ? '#666' : '#28a745';
            el.textContent = (this._forecastStop ? 'Stopped' : 'Done')
                + `: ${done.toLocaleString()} days, ${runs.toLocaleString()} runs`
                + (missing ? ` (${missing} run(s) not in MET's archive)` : '') + '.';
        }
        this.loadForecastStatus();
    },

    /** Stations file for fetch_met_nordic.py --stations. */
    downloadStationsCsv: function() {
        const rows = (this.weatherStations || []).filter(s => s.latitude && s.longitude);
        if (!rows.length) {
            alert('No stations with a position.');
            return;
        }
        const clean = v => String(v ?? '').replace(/[,\r\n]/g, ' ').trim();
        const csv = 'station_id,name,latitude,longitude,elevation\n' + rows.map(s =>
            [clean(s.station_id), clean(s.name), s.latitude, s.longitude, s.elevation ?? 0].join(',')
        ).join('\n') + '\n';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'stations.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    /**
     * Import forecast CSV files: read in the browser and sent in chunks small
     * enough for the host's request limit. Re-importing replaces rows.
     */
    importForecasts: async function() {
        const input = document.getElementById('forecast-files');
        const progress = document.getElementById('forecast-import-progress');
        const btn = document.getElementById('forecast-import-btn');
        const files = Array.from(input?.files || []);
        if (!files.length) {
            alert('Choose one or more forecasts_*.csv files first.');
            return;
        }
        const columns = ['station_id', 'source', 'issued_at', 'available_at', 'valid_at',
                         'air_temperature', 'wind_speed', 'humidity', 'cloud_cover', 'solar_w_m2'];
        const CHUNK = 500;  // about 67 KB of JSON (host limit about 128 KB a request)
        btn.disabled = true;
        let total = 0;
        try {
            for (const [f, file] of files.entries()) {
                const lines = (await file.text()).split(/\r?\n/).filter(l => l.trim() !== '');
                const header = (lines.shift() || '').split(',').map(h => h.trim());
                const idx = columns.map(c => header.indexOf(c));
                const missing = columns.filter((c, k) => idx[k] < 0 && c !== 'cloud_cover' && c !== 'solar_w_m2');
                if (missing.length) {
                    throw new Error(`${file.name}: missing column(s) ${missing.join(', ')}`);
                }
                const rows = lines.map(l => {
                    const v = l.split(',');
                    return idx.map(i => (i < 0 || v[i] === undefined || v[i] === '') ? null : v[i].trim());
                });
                for (let k = 0; k < rows.length; k += CHUNK) {
                    progress.style.color = '#666';
                    progress.textContent = `File ${f + 1}/${files.length} (${file.name}): `
                        + `${Math.min(k + CHUNK, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} rows`;
                    const res = await fetch('./api/heataq_api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'import_forecasts', rows: rows.slice(k, k + CHUNK) })
                    });
                    const data = await res.json();
                    if (!res.ok || data.error) {
                        throw new Error(`${file.name}, rows ${k + 1}-${k + CHUNK}: ${data.error || res.status}`);
                    }
                    total += data.imported;
                }
            }
            progress.style.color = '#28a745';
            progress.textContent = `Imported ${total.toLocaleString()} forecast hours from ${files.length} file(s).`;
            input.value = '';
        } catch (err) {
            progress.style.color = '#dc3545';
            progress.textContent = `Import stopped: ${err.message}` + (total ? ` (${total.toLocaleString()} rows imported before)` : '');
        } finally {
            btn.disabled = false;
            this.loadForecastStatus();
        }
    },

    populateStationDropdown: function() {
        const select = document.getElementById('weather-station-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- Select Station --</option>' +
            this.weatherStations.map(s =>
                `<option value="${escapeHtml(s.station_id)}">${escapeHtml(s.name)}</option>`
            ).join('');
    },

    onStationChange: async function() {
        const select = document.getElementById('weather-station-select');
        this.selectedStationId = select ? select.value : '';

        const detailsDiv = document.getElementById('station-details');
        const noStationMsg = document.getElementById('no-station-message');
        const updateDataBtn = document.getElementById('update-data-btn');
        const interpolateBtn = document.getElementById('interpolate-missing-btn');

        if (this.selectedStationId) {
            // Show station details and update data button
            if (detailsDiv) detailsDiv.style.display = 'block';
            if (noStationMsg) noStationMsg.style.display = 'none';
            if (updateDataBtn) updateDataBtn.style.display = 'inline-block';
            if (interpolateBtn) interpolateBtn.style.display = 'inline-block';

            // Populate fields from station data
            const station = this.weatherStations.find(s => s.station_id === this.selectedStationId);
            if (station) {
                // Location with Google Maps link
                const locationEl = document.getElementById('station-location');
                if (locationEl && station.latitude && station.longitude) {
                    locationEl.innerHTML = `<a href="#" onclick="app.admin.openGoogleMaps(${escapeJsArg(parseFloat(station.latitude))}, ${escapeJsArg(parseFloat(station.longitude))}); return false;" style="color: var(--primary);">📍 ${parseFloat(station.latitude).toFixed(4)}, ${parseFloat(station.longitude).toFixed(4)}</a>`;
                } else if (locationEl) {
                    locationEl.textContent = '-';
                }

                // Editable fields — no silent defaults; blank when unset so the
                // user is obliged to supply them (see docs/WIND_CORRECTION.md).
                const windHeightEl = document.getElementById('station-wind-height');
                const roughnessEl = document.getElementById('station-roughness');
                if (windHeightEl) {
                    windHeightEl.value = (station.measurement_height_wind !== null
                        && station.measurement_height_wind !== undefined
                        && station.measurement_height_wind !== '')
                        ? station.measurement_height_wind : '';
                }
                if (roughnessEl) roughnessEl.innerHTML = this.roughnessOptionsHtml(station.terrain_roughness);

                // Location map
                this.renderStationMap(station.latitude, station.longitude);
            }
        } else {
            // Hide details and button when no station selected
            if (detailsDiv) detailsDiv.style.display = 'none';
            if (noStationMsg) noStationMsg.style.display = 'block';
            if (updateDataBtn) updateDataBtn.style.display = 'none';
            if (interpolateBtn) interpolateBtn.style.display = 'none';
        }

        await this.loadWeatherData();
    },

    loadWeatherData: async function() {
        // Only load data if a station is selected
        if (!this.selectedStationId) {
            // Clear the data displays
            this.weatherSummary = {};
            this.weatherYearly = [];
            this.renderWeatherSummary({});
            this.renderYearlyAverages([]);
            this.renderMonthlyAverages([]);
            return;
        }

        const stationParam = `&station_id=${this.selectedStationId}`;

        try {
            const [summaryRes, yearlyRes, monthlyRes] = await Promise.all([
                fetch(`./api/heataq_api.php?action=get_weather_stations${stationParam}`),
                fetch(`./api/heataq_api.php?action=get_weather_yearly_averages${stationParam}`),
                fetch(`./api/heataq_api.php?action=get_weather_monthly_averages${stationParam}`)
            ]);

            const summaryData = await summaryRes.json();
            const yearlyData = await yearlyRes.json();
            const monthlyData = await monthlyRes.json();

            // Kept for the Update planner and Interpolate Missing (real data,
            // not text scraped back out of the rendered panel).
            this.weatherSummary = summaryData.summary || {};
            this.weatherYearly = yearlyData.yearly_averages || [];

            if (summaryData.summary) {
                this.renderWeatherSummary(summaryData.summary);
            }

            if (yearlyData.yearly_averages) {
                this.renderYearlyAverages(yearlyData.yearly_averages);
            }

            if (monthlyData.monthly_averages) {
                this.renderMonthlyAverages(monthlyData.monthly_averages);
            }
        } catch (err) {
            console.error('Failed to load weather data:', err);
        }
    },

    renderWeatherStations: function() {
        const container = document.getElementById('weather-stations-list');
        if (!container) return;

        if (this.weatherStations.length === 0) {
            container.innerHTML = '<p class="text-muted">No weather stations configured</p>';
            return;
        }

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Name</th><th>Station ID</th><th>Location</th><th>Wind Height</th><th>Roughness</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        this.weatherStations.forEach(station => {
            const lat = station.latitude;
            const lon = station.longitude;
            const hasLocation = lat && lon;
            const locationHtml = hasLocation
                ? `<a href="#" onclick="app.admin.openGoogleMaps(${escapeJsArg(parseFloat(lat))}, ${escapeJsArg(parseFloat(lon))}); return false;" title="Open in Google Maps" style="color: var(--primary);">📍 ${parseFloat(lat).toFixed(4)}, ${parseFloat(lon).toFixed(4)}</a>`
                : '-';

            const windHeight = station.measurement_height_wind
                ? `${escapeHtml(station.measurement_height_wind)}m`
                : '<span style="color: var(--danger);">—</span>';
            const roughness = (station.terrain_roughness !== null && station.terrain_roughness !== undefined && station.terrain_roughness !== '')
                ? escapeHtml(station.terrain_roughness)
                : '<span style="color: var(--danger);">—</span>';

            html += `<tr>
                <td>${escapeHtml(station.name)}</td>
                <td><code>${escapeHtml(station.station_id)}</code></td>
                <td>${locationHtml}</td>
                <td>${windHeight}</td>
                <td>${roughness}</td>
                <td>
                    <button class="btn btn-xs btn-primary" onclick="app.admin.editWeatherStation(${escapeJsArg(station.station_id)})">Edit</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    openGoogleMaps: function(lat, lon) {
        const url = `https://www.google.com/maps?q=${lat},${lon}&z=14`;
        window.open(url, '_blank');
    },

    renderWeatherSummary: function(summary) {
        const dateRange = document.getElementById('weather-date-range');
        const recordCount = document.getElementById('weather-record-count');

        if (dateRange) {
            dateRange.textContent = summary.min_date && summary.max_date
                ? `${summary.min_date} to ${summary.max_date}`
                : '-';
        }
        if (recordCount) {
            recordCount.textContent = summary.record_count
                ? summary.record_count.toLocaleString()
                : '-';
        }
    },

    addWeatherStation: function() {
        this.showStationModal(null);
    },

    editWeatherStation: function(stationId) {
        const station = this.weatherStations.find(s => s.station_id === stationId);
        if (station) {
            this.showStationModal(station);
        }
    },

    showStationModal: function(existingStation) {
        const isEdit = !!existingStation;
        const title = isEdit ? 'Edit Weather Station' : 'Add Weather Station';
        const today = new Date().toISOString().split('T')[0];

        let html = `
            <div class="modal-overlay" onclick="app.admin.closeStationModal()">
                <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px;">
                    <h3>${title}</h3>
                    ${!isEdit ? `
                    <div class="form-group">
                        <label>Station ID</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="station-id-input" class="form-control" placeholder="e.g. SN38140 or 38140" style="flex: 1;">
                            <button class="btn btn-secondary" onclick="app.admin.checkStation()">Check</button>
                        </div>
                    </div>
                    <div id="station-check-result" style="display: none; margin-bottom: 15px; padding: 12px; background: var(--neutral-100); border-radius: 4px;">
                    </div>
                    ` : `
                    <div class="form-group">
                        <label>Station ID</label>
                        <input type="text" class="form-control" value="${escapeHtml(existingStation.station_id)}" disabled>
                    </div>
                    `}
                    <div class="form-group">
                        <label>Station Name</label>
                        <input type="text" id="station-name-input" class="form-control" value="${escapeHtml(existingStation?.name || '')}" placeholder="Station name">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Latitude</label>
                            <input type="number" id="station-lat-input" class="form-control" value="${escapeHtml(existingStation?.latitude || '')}" step="0.0001" placeholder="58.3397">
                        </div>
                        <div class="form-group">
                            <label>Longitude</label>
                            <input type="number" id="station-lon-input" class="form-control" value="${escapeHtml(existingStation?.longitude || '')}" step="0.0001" placeholder="8.5194">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Elevation (m)</label>
                            <input type="number" id="station-elevation-input" class="form-control" value="${escapeHtml(existingStation?.elevation || '')}" placeholder="7">
                        </div>
                        <div class="form-group">
                            <label>Wind Height (m)</label>
                            <input type="number" id="station-wind-height-input" class="form-control" value="${escapeHtml(existingStation?.measurement_height_wind ?? '')}" step="0.1" placeholder="from Frost / required">
                        </div>
                        <div class="form-group">
                            <label>Roughness (z₀)</label>
                            <select id="station-roughness-input" class="form-control">${this.roughnessOptionsHtml(existingStation?.terrain_roughness)}</select>
                        </div>
                    </div>
                    ${!isEdit ? `
                    <div class="form-row" id="fetch-data-section" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--neutral-200);">
                        <div class="form-group">
                            <label>Fetch Data From</label>
                            <input type="date" id="station-fetch-start" class="form-control" value="2015-01-01">
                        </div>
                        <div class="form-group">
                            <label>To</label>
                            <input type="date" id="station-fetch-end" class="form-control" value="${today}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="station-fetch-data" checked style="width: 16px; height: 16px;">
                            <span>Fetch weather data after adding station</span>
                        </label>
                    </div>
                    ` : ''}
                    <div class="form-actions">
                        <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Cancel</button>
                        ${isEdit ? `<button class="btn btn-danger" onclick="app.admin.deleteWeatherStation(${escapeJsArg(existingStation.station_id)})" style="margin-right: auto;">Delete</button>` : ''}
                        <button class="btn ${isEdit ? 'btn-primary' : ''}" ${isEdit ? '' : 'style="background: #90EE90; color: #000;"'} onclick="app.admin.saveStation(${escapeJsArg(existingStation?.station_id || '')})">${isEdit ? 'Save' : '+ Add Station'}</button>
                    </div>
                </div>
            </div>
        `;

        // Create modal container
        let modalContainer = document.getElementById('station-modal-container');
        if (!modalContainer) {
            modalContainer = document.createElement('div');
            modalContainer.id = 'station-modal-container';
            document.body.appendChild(modalContainer);
        }
        modalContainer.innerHTML = html;
    },

    closeStationModal: function() {
        const container = document.getElementById('station-modal-container');
        if (container) {
            container.remove();
        }
    },

    checkStation: async function() {
        const input = document.getElementById('station-id-input');
        const resultDiv = document.getElementById('station-check-result');
        if (!input || !resultDiv) return;

        const stationId = input.value.trim();
        if (!stationId) {
            alert('Please enter a station ID');
            return;
        }

        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<p>Checking station...</p>';

        try {
            const response = await fetch(`./api/frost_api.php?action=check_station&station_id=${encodeURIComponent(stationId)}`);
            const data = await response.json();

            if (data.found) {
                // Fill in the form fields
                document.getElementById('station-name-input').value = data.name || '';
                document.getElementById('station-lat-input').value = data.latitude || '';
                document.getElementById('station-lon-input').value = data.longitude || '';
                document.getElementById('station-elevation-input').value = data.elevation || '';
                if (data.recommended_wind_height) {
                    document.getElementById('station-wind-height-input').value = data.recommended_wind_height;
                }

                // Show result
                const elements = data.available_elements || {};
                const windLevels = data.wind_levels || [];
                const dateRange = data.data_range || {};

                // Set fetch date range - use 2015-01-01 or station start date (whichever is later)
                const defaultStart = '2015-01-01';
                const stationStart = dateRange.from ? dateRange.from.split('T')[0] : null;
                const fetchStart = stationStart && stationStart > defaultStart ? stationStart : defaultStart;
                const today = new Date().toISOString().split('T')[0];
                const fetchEnd = dateRange.to ? dateRange.to.split('T')[0] : today;

                const fetchStartEl = document.getElementById('station-fetch-start');
                const fetchEndEl = document.getElementById('station-fetch-end');
                if (fetchStartEl) fetchStartEl.value = fetchStart;
                if (fetchEndEl) fetchEndEl.value = fetchEnd > today ? today : fetchEnd;

                resultDiv.innerHTML = `
                    <div style="color: var(--success); font-weight: 500; margin-bottom: 8px;">✓ Station Found: ${escapeHtml(data.name)}</div>
                    <table class="data-table compact" style="font-size: 12px;">
                        <tr><td>Location</td><td>${escapeHtml(data.latitude?.toFixed(4) || '-')}°N, ${escapeHtml(data.longitude?.toFixed(4) || '-')}°E, ${escapeHtml(data.elevation || '-')}m</td></tr>
                        <tr><td>Municipality</td><td>${escapeHtml(data.municipality || '-')}, ${escapeHtml(data.county || '-')}</td></tr>
                        <tr><td>Data Range</td><td>${escapeHtml(dateRange.from || '?')} → ${escapeHtml(dateRange.to || 'now')}</td></tr>
                        <tr><td>Elements</td><td>
                            temp ${elements.air_temperature ? '✓' : '✗'} |
                            wind ${elements.wind_speed ? '✓' : '✗'} |
                            humidity ${elements.relative_humidity ? '✓' : '✗'} |
                            solar ${elements.solar ? '✓' : '✗'}
                        </td></tr>
                        ${windLevels.length > 0
                            ? `<tr><td>Wind Levels</td><td>${escapeHtml(windLevels.map(l => l + 'm').join(', '))}${data.recommended_wind_height ? ` (using ${escapeHtml(data.recommended_wind_height)}m)` : ''}</td></tr>`
                            : `<tr><td>Wind Levels</td><td style="color: var(--danger);">none reported — enter wind height manually</td></tr>`}
                    </table>
                `;
            } else {
                resultDiv.innerHTML = `<div style="color: var(--danger);">✗ Station not found: ${escapeHtml(data.error || 'Unknown error')}</div>`;
            }
        } catch (err) {
            resultDiv.innerHTML = `<div style="color: var(--danger);">✗ Error checking station: ${escapeHtml(err.message)}</div>`;
        }
    },

    saveStation: async function(existingId) {
        const isEdit = !!existingId;
        const stationId = isEdit ? existingId : document.getElementById('station-id-input')?.value.trim();
        const name = document.getElementById('station-name-input')?.value.trim();
        const latitude = document.getElementById('station-lat-input')?.value;
        const longitude = document.getElementById('station-lon-input')?.value;
        const elevation = document.getElementById('station-elevation-input')?.value;
        const windHeight = document.getElementById('station-wind-height-input')?.value || '';
        const roughness = document.getElementById('station-roughness-input')?.value || '';

        // Get fetch options (only for new stations)
        const shouldFetch = !isEdit && document.getElementById('station-fetch-data')?.checked;
        const fetchStart = document.getElementById('station-fetch-start')?.value;
        const fetchEnd = document.getElementById('station-fetch-end')?.value;

        if (!stationId || !name) {
            alert('Station ID and Name are required');
            return;
        }
        if (!windHeight || parseFloat(windHeight) <= 0) {
            alert('Wind height (m) is required. If Frost reported none, enter it manually.');
            return;
        }
        if (!roughness || parseFloat(roughness) <= 0) {
            alert('Select a terrain roughness class.');
            return;
        }

        const normalizedStationId = stationId.toUpperCase().startsWith('SN') ? stationId.toUpperCase() : 'SN' + stationId;

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: isEdit ? 'update_weather_station' : 'add_weather_station',
                    station_id: normalizedStationId,
                    station_name: name,
                    latitude: latitude || null,
                    longitude: longitude || null,
                    elevation: elevation || null,
                    measurement_height_wind: windHeight,
                    terrain_roughness: roughness
                })
            });

            const data = await response.json();
            if (data.error) {
                alert('Error: ' + data.error);
            } else {
                await this.loadWeatherStations();
                api.utils.showSuccess(isEdit ? 'Station updated' : 'Station added');

                // Fetch weather data if requested (new stations only)
                if (shouldFetch && fetchStart && fetchEnd) {
                    await this.fetchWeatherDataForStation(normalizedStationId, fetchStart, fetchEnd);
                } else {
                    this.closeStationModal();
                }
            }
        } catch (err) {
            alert('Error saving station: ' + err.message);
        }
    },

    // Show modal to update/fetch weather data for selected station
    showUpdateDataModal: async function() {
        if (!this.selectedStationId) {
            alert('No station selected');
            return;
        }

        const station = this.weatherStations.find(s => s.station_id === this.selectedStationId);
        if (!station) return;

        // Gate: don't import weather we can't correctly interpret. Wind height and
        // terrain roughness must be set first (see docs/WIND_CORRECTION.md).
        if (!this.stationWindConfigured(station)) {
            alert('Set a wind height and terrain roughness for this station, then Save, before importing weather data.');
            return;
        }

        // Create modal with loading state
        let html = `
            <div class="modal-overlay" onclick="app.admin.closeStationModal()">
                <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 500px;">
                    <h3>Update Weather Data - ${escapeHtml(station.name)}</h3>
                    <div id="update-data-content">
                        <p class="text-muted">Checking available data from Frost API...</p>
                    </div>
                </div>
            </div>
        `;

        let modalContainer = document.getElementById('station-modal-container');
        if (!modalContainer) {
            modalContainer = document.createElement('div');
            modalContainer.id = 'station-modal-container';
            document.body.appendChild(modalContainer);
        }
        modalContainer.innerHTML = html;

        // Query Frost API for available data
        try {
            const response = await fetch(`./api/frost_api.php?action=check_station&station_id=${encodeURIComponent(this.selectedStationId)}`);
            const frostData = await response.json();

            const contentDiv = document.getElementById('update-data-content');
            if (!contentDiv) return;

            if (!frostData.found) {
                contentDiv.innerHTML = `
                    <p style="color: var(--danger);">Station not found in Frost API</p>
                    <p class="text-muted" style="font-size: 11px;">
                        Station ID used: ${escapeHtml(frostData.station_id_used || this.selectedStationId)}<br>
                        ${escapeHtml(frostData.error || '')}<br>
                        ${frostData.http_code ? 'HTTP: ' + escapeHtml(frostData.http_code) : ''}
                    </p>
                    <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Close</button>
                `;
                return;
            }

            // Current data comes from the loaded summary (not scraped from the
            // panel text — the old "→" parse never matched the rendered "to",
            // so every Update silently re-fetched from 2015).
            const summary = this.weatherSummary || {};
            const currentRange = summary.min_date && summary.max_date
                ? `${summary.min_date} → ${summary.max_date}` : 'no data yet';
            const currentCount = summary.record_count ? Number(summary.record_count).toLocaleString() : '0';

            const frostDateRange = frostData.data_range || {};
            const today = new Date().toISOString().split('T')[0];
            const frostStartRaw = frostDateRange.from ? frostDateRange.from.split('T')[0] : '2015-01-01';
            const frostStart = frostStartRaw > '2015-01-01' ? frostStartRaw : '2015-01-01';
            const frostEndRaw = frostDateRange.to ? frostDateRange.to.split('T')[0] : today;
            const frostEnd = frostEndRaw > today ? today : frostEndRaw;
            this._updateFrostRange = { frostStart, frostEnd };

            contentDiv.innerHTML = `
                <table class="data-table compact" style="font-size: 13px; margin-bottom: 15px;">
                    <tr><td style="width: 140px;">Current Data</td><td>${escapeHtml(currentRange)} (${escapeHtml(currentCount)} records)</td></tr>
                    <tr><td>Frost API Range</td><td>${escapeHtml(frostStart)} → ${escapeHtml(frostEnd)}</td></tr>
                </table>
                <div style="margin-bottom: 12px; font-size: 13px;">
                    <label style="display:block; margin-bottom:6px; cursor:pointer;">
                        <input type="radio" name="update-mode" value="missing" checked onchange="app.admin.renderUpdatePlan()">
                        <strong>Missing data only</strong> — new data since the last stored date, plus years with missing hours
                    </label>
                    <label style="display:block; margin-bottom:6px; cursor:pointer;">
                        <input type="radio" name="update-mode" value="recheck" onchange="app.admin.renderUpdatePlan()">
                        <strong>Missing + recheck interpolated</strong> — also re-fetch years with interpolated hours (Frost may have back-filled them)
                    </label>
                    <label style="display:block; cursor:pointer;">
                        <input type="radio" name="update-mode" value="full" onchange="app.admin.renderUpdatePlan()">
                        <strong>Full refresh</strong> — every year in a date range
                    </label>
                </div>
                <div id="update-full-range" class="form-row" style="margin-bottom: 12px; display: none;">
                    <div class="form-group">
                        <label>Fetch From</label>
                        <input type="date" id="update-fetch-start" class="form-control" value="${escapeHtml(frostStart)}">
                    </div>
                    <div class="form-group">
                        <label>To</label>
                        <input type="date" id="update-fetch-end" class="form-control" value="${escapeHtml(frostEnd)}">
                    </div>
                </div>
                <p id="update-plan-preview" style="font-size: 13px; margin-bottom: 8px;"></p>
                <p class="text-muted" style="font-size: 12px; margin-bottom: 15px;">
                    Real Frost values replace interpolated ones; hours Frost leaves blank never overwrite stored values.
                </p>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Cancel</button>
                    <button class="btn btn-primary" id="update-fetch-btn" onclick="app.admin.startUpdateDataFetch()">Fetch Data</button>
                </div>
            `;
            this.renderUpdatePlan();
        } catch (err) {
            const contentDiv = document.getElementById('update-data-content');
            if (contentDiv) {
                contentDiv.innerHTML = `
                    <p style="color: var(--danger);">Error checking Frost API: ${escapeHtml(err.message)}</p>
                    <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Close</button>
                `;
            }
        }
    },

    // Years an Update should fetch. Frost is fetched a whole year at a time, so
    // "missing" = the tail after the last stored date + years with missing hours
    // + years inside the stored range with no rows at all. "recheck" also adds
    // years containing interpolated hours. Years complete only thanks to
    // interpolation are skipped by "missing" (keeps the default fast).
    planUpdateYears: function(mode) {
        const { frostStart, frostEnd } = this._updateFrostRange || {};
        if (!frostStart || !frostEnd) return [];
        const firstYear = parseInt(frostStart.slice(0, 4), 10);
        const lastYear = parseInt(frostEnd.slice(0, 4), 10);
        const years = new Set();

        const summary = this.weatherSummary || {};
        const yearly = this.weatherYearly || [];
        if (!summary.max_date) {
            for (let y = firstYear; y <= lastYear; y++) years.add(y);
        } else {
            // Tail: from the day after the last stored date
            const next = new Date(summary.max_date + 'T00:00:00Z');
            next.setUTCDate(next.getUTCDate() + 1);
            for (let y = next.getUTCFullYear(); y <= lastYear; y++) years.add(y);

            // Whole years absent inside the stored range (no yearly row at all)
            const present = new Set(yearly.map(r => parseInt(r.year, 10)));
            const minY = parseInt(summary.min_date.slice(0, 4), 10);
            const maxY = parseInt(summary.max_date.slice(0, 4), 10);
            for (let y = minY; y <= maxY; y++) if (!present.has(y)) years.add(y);

            yearly.forEach(r => {
                const y = parseInt(r.year, 10);
                if (Number(r.incomplete_hours) > 0) years.add(y);
                if (mode === 'recheck' && Number(r.interpolated_hours) > 0) years.add(y);
            });
        }
        return [...years].filter(y => y >= firstYear && y <= lastYear).sort((a, b) => a - b);
    },

    // Preview of what the selected Update mode will fetch
    renderUpdatePlan: function() {
        const mode = document.querySelector('input[name="update-mode"]:checked')?.value || 'missing';
        const rangeEl = document.getElementById('update-full-range');
        const previewEl = document.getElementById('update-plan-preview');
        const btn = document.getElementById('update-fetch-btn');
        if (rangeEl) rangeEl.style.display = mode === 'full' ? 'flex' : 'none';
        if (!previewEl) return;

        if (mode === 'full') {
            previewEl.textContent = 'Will fetch every year in the selected range.';
            if (btn) btn.disabled = false;
            return;
        }
        const years = this.planUpdateYears(mode);
        if (years.length === 0) {
            previewEl.innerHTML = '<span style="color: var(--success);">Nothing to fetch — data is complete'
                + (mode === 'missing' ? ' (interpolated hours not rechecked)' : '') + '.</span>';
            if (btn) btn.disabled = true;
        } else {
            previewEl.innerHTML = `Will fetch <strong>${years.length}</strong> year(s): ${years.join(', ')}`;
            if (btn) btn.disabled = false;
        }
    },

    // Start fetching data from the update modal
    startUpdateDataFetch: async function() {
        const mode = document.querySelector('input[name="update-mode"]:checked')?.value || 'missing';

        if (mode === 'full') {
            const startDate = document.getElementById('update-fetch-start')?.value;
            const endDate = document.getElementById('update-fetch-end')?.value;
            if (!startDate || !endDate) {
                alert('Please select a date range');
                return;
            }
            await this.fetchWeatherDataForStation(this.selectedStationId, startDate, endDate);
            return;
        }

        const years = this.planUpdateYears(mode);
        if (years.length === 0) {
            alert('Nothing to fetch — data is already complete.');
            return;
        }
        await this.fetchWeatherYears(this.selectedStationId, years);
    },

    // Fetch weather data for a date range (all years in it)
    fetchWeatherDataForStation: async function(stationId, startDate, endDate) {
        const startYear = parseInt(startDate.split('-')[0]);
        const endYear = parseInt(endDate.split('-')[0]);
        const years = [];
        for (let y = startYear; y <= endYear; y++) {
            years.push(y);
        }
        await this.fetchWeatherYears(stationId, years);
    },

    // Fetch weather data for an explicit list of years, with progress
    fetchWeatherYears: async function(stationId, years) {
        // Update modal to show progress
        const modalContent = document.querySelector('#station-modal-container .modal-content');
        if (modalContent) {
            modalContent.innerHTML = `
                <h3>Fetching Weather Data</h3>
                <div style="margin: 20px 0;">
                    <p id="fetch-status">Preparing to fetch ${years.length} years of data...</p>
                    <div style="background: var(--neutral-200); border-radius: 4px; height: 20px; margin-top: 10px;">
                        <div id="fetch-progress-bar" style="background: var(--primary); height: 100%; border-radius: 4px; width: 0%; transition: width 0.3s;"></div>
                    </div>
                    <p id="fetch-details" class="text-muted" style="font-size: 12px; margin-top: 8px;">Starting...</p>
                </div>
            `;
        }

        const statusEl = document.getElementById('fetch-status');
        const progressBar = document.getElementById('fetch-progress-bar');
        const detailsEl = document.getElementById('fetch-details');

        let totalInserted = 0;
        let totalSkipped = 0;
        let errors = [];
        let warnings = [];

        // Fetch one year with retry + exponential backoff. A single transient
        // Frost failure (timeout, 429, 5xx) previously left a permanent silent
        // one-year hole in the data (e.g. Svalbard missing all of 2025).
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const fetchYearOnce = async (year) => {
            const response = await fetch(`./api/frost_api.php?action=fetch_and_store_year&station_id=${encodeURIComponent(stationId)}&year=${year}`, { method: 'POST' });
            // Read as text first: a PHP timeout/fatal returns an HTML page, and
            // response.json() then only says "Unexpected token..." — show what
            // the server actually sent instead.
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
                throw new Error(`HTTP ${response.status}, non-JSON response: ${snippet || '(empty response)'}`);
            }
            if (data.error) throw new Error(data.error);
            return data;
        };
        const fetchYearWithRetry = async (year, attempts = 3) => {
            for (let a = 1; ; a++) {
                try {
                    return await fetchYearOnce(year);
                } catch (err) {
                    if (a >= attempts) throw err;
                    if (detailsEl) detailsEl.textContent = `${year}: attempt ${a} failed (${err.message}) - retrying...`;
                    await sleep(2000 * Math.pow(2, a - 1)); // 2s, 4s
                }
            }
        };
        const recordResult = (year, data) => {
            totalInserted += data.inserted || 0;
            totalSkipped += (data.skipped || 0) + (data.updated || 0);
            if (detailsEl) detailsEl.textContent = `${year}: ${data.inserted || 0} inserted, ${data.updated || 0} updated, ${data.skipped || 0} unchanged`;
            // Completeness signal from the API: flag short years so partial
            // Frost coverage is visible instead of silently accepted.
            if (data.wind_other_height_hours > 0) {
                warnings.push(`${year}: ${data.wind_other_height_hours} hours had wind only at another height than the station's wind height - left empty (check the station's wind height)`);
            }
            if (data.completeness_pct !== undefined && data.completeness_pct !== null && data.completeness_pct < 90) {
                warnings.push(`${year}: only ${data.completeness_pct}% of expected hours returned by Frost`);
            }
        };

        const failedYears = [];
        for (let i = 0; i < years.length; i++) {
            const year = years[i];
            const progress = Math.round(((i) / years.length) * 100);

            if (statusEl) statusEl.textContent = `Fetching ${year}... (${i + 1}/${years.length})`;
            if (progressBar) progressBar.style.width = progress + '%';

            try {
                recordResult(year, await fetchYearWithRetry(year));
            } catch (err) {
                failedYears.push(year);
                errors.push(`${year}: ${err.message}`);
                if (detailsEl) detailsEl.textContent = `${year}: Error - ${err.message}`;
            }
        }

        // Final requeue: one more pass over failed years (Frost hiccups are
        // often gone minutes later; this pass costs nothing when all succeeded).
        for (const year of failedYears.slice()) {
            if (statusEl) statusEl.textContent = `Retrying failed year ${year}...`;
            try {
                recordResult(year, await fetchYearWithRetry(year, 2));
                failedYears.splice(failedYears.indexOf(year), 1);
                errors = errors.filter(e => !e.startsWith(`${year}:`));
            } catch (err) {
                // keep the recorded error
            }
        }

        // Show completion
        if (progressBar) progressBar.style.width = '100%';
        if (statusEl) {
            if (errors.length > 0) {
                statusEl.innerHTML = `<span style="color: var(--danger);">Completed with ${errors.length} FAILED year(s): ${escapeHtml(failedYears.join(', '))} - re-run Update Data to fill the gap</span>`;
            } else if (warnings.length > 0) {
                statusEl.innerHTML = `<span style="color: var(--warning);">Completed with warnings: ${escapeHtml(warnings.join(' | '))}</span>`;
            } else {
                statusEl.innerHTML = `<span style="color: var(--success);">✓ Completed successfully!</span>`;
            }
        }
        if (detailsEl) {
            detailsEl.textContent = `Total: ${totalInserted.toLocaleString()} records inserted, ${totalSkipped.toLocaleString()} updated/unchanged`
                + (errors.length ? ` | Errors: ${errors.join(' | ')}` : '');
        }

        // Add close button
        if (modalContent) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn btn-primary';
            closeBtn.textContent = 'Close';
            closeBtn.style.marginTop = '15px';
            closeBtn.onclick = () => this.closeStationModal();
            modalContent.appendChild(closeBtn);
        }

        // Reload weather stations and refresh data display
        await this.loadWeatherStations();
        // Re-select the station and refresh UI state + data tables
        const select = document.getElementById('weather-station-select');
        if (select) select.value = stationId;
        await this.onStationChange();

        // Point at the next step when gaps remain after the fetch
        const remaining = (this.weatherYearly || []).reduce((s, r) => s + (Number(r.incomplete_hours) || 0), 0);
        if (modalContent && remaining > 0) {
            const hint = document.createElement('p');
            hint.className = 'text-muted';
            hint.style.cssText = 'font-size: 12px; margin-top: 10px;';
            hint.textContent = `${remaining.toLocaleString()} hour(s) still missing. Use "Interpolate Missing" to fill short gaps.`;
            modalContent.insertBefore(hint, modalContent.lastElementChild);
        }
    },

    deleteWeatherStation: async function(stationId) {
        if (!confirm(`Delete weather station ${stationId}?\n\nThis will NOT delete the weather data.`)) {
            return;
        }

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_weather_station',
                    station_id: stationId
                })
            });

            const data = await response.json();
            if (data.error) {
                alert('Error: ' + data.error);
            } else {
                this.closeStationModal();
                await this.loadWeatherStations();
                api.utils.showSuccess('Station deleted');
            }
        } catch (err) {
            alert('Error deleting station: ' + err.message);
        }
    },

    // Save station inline (from Weather Data card)
    saveStationInline: async function() {
        if (!this.selectedStationId) {
            alert('No station selected');
            return;
        }

        const station = this.weatherStations.find(s => s.station_id === this.selectedStationId);
        if (!station) return;

        const windHeight = document.getElementById('station-wind-height')?.value || '';
        const roughness = document.getElementById('station-roughness')?.value || '';

        if (!windHeight || parseFloat(windHeight) <= 0) {
            alert('Wind height (m) is required.');
            return;
        }
        if (!roughness || parseFloat(roughness) <= 0) {
            alert('Select a terrain roughness class.');
            return;
        }

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_weather_station',
                    station_id: this.selectedStationId,
                    station_name: station.name,
                    latitude: station.latitude,
                    longitude: station.longitude,
                    elevation: station.elevation,
                    measurement_height_wind: windHeight,
                    terrain_roughness: roughness
                })
            });

            const data = await response.json();
            if (data.error) {
                alert('Error: ' + data.error);
            } else {
                await this.loadWeatherStations();
                // Re-select the station to refresh the dropdown selection
                const select = document.getElementById('weather-station-select');
                if (select) select.value = this.selectedStationId;
                await this.onStationChange();
                api.utils.showSuccess('Station updated');
            }
        } catch (err) {
            alert('Error saving station: ' + err.message);
        }
    },

    // Delete selected station from Weather Data card
    deleteSelectedStation: async function() {
        if (!this.selectedStationId) {
            alert('No station selected');
            return;
        }
        await this.deleteWeatherStation(this.selectedStationId);
        // Reset selection
        this.selectedStationId = '';
        const select = document.getElementById('weather-station-select');
        if (select) select.value = '';
        await this.onStationChange();
    },

    renderYearlyAverages: function(data) {
        const container = document.getElementById('weather-yearly-averages');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<p class="text-muted">No data available</p>';
            return;
        }

        let html = `<table class="data-table compact">
            <thead><tr>
                <th>Year</th>
                <th>Avg °C</th>
                <th>Min °C</th>
                <th>Max °C</th>
                <th>Wind m/s</th>
                <th>Humidity %</th>
                <th title="Missing rows + hours with NULL temp/wind/humidity, within the station's data range. Click to see details.">Missing h</th>
                <th title="Hours reconstructed by interpolation (flagged is_interpolated)">Filled h</th>
            </tr></thead><tbody>`;

        data.forEach(row => {
            // incomplete_hours = missing rows + NULL-field hours (what the
            // simulator's strict validation stops on). Clickable when > 0.
            const inc = row.incomplete_hours;
            let missCell = '-';
            if (inc !== undefined && inc !== null) {
                missCell = inc > 0
                    ? `<a href="#" onclick="app.admin.showWeatherGaps(${escapeJsArg(parseInt(row.year, 10))}); return false;"
                         style="color: var(--danger); font-weight: bold;">${escapeHtml(inc)} ⚠</a>`
                    : '<span style="color: var(--success);">0 ✓</span>';
            }
            const interp = (row.interpolated_hours !== undefined && row.interpolated_hours !== null)
                ? (Number(row.interpolated_hours) > 0 ? `<span style="color: #b8860b;">${escapeHtml(row.interpolated_hours)}</span>` : '0')
                : '-';
            html += `<tr>
                <td>${escapeHtml(row.year)}</td>
                <td>${escapeHtml(row.avg_temp)}</td>
                <td>${escapeHtml(row.min_temp)}</td>
                <td>${escapeHtml(row.max_temp)}</td>
                <td>${escapeHtml(row.avg_wind)}</td>
                <td>${escapeHtml(row.avg_humidity)}</td>
                <td style="text-align: right;">${missCell}</td>
                <td style="text-align: right;">${interp}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    // Show the missing/incomplete hour details for one station-year, with an
    // explicit "fill by interpolation" action (flagged, never silent).
    // Shared dialog for gap inspection / interpolation results
    openWeatherGapsModal: function(title) {
        let modal = document.getElementById('weather-gaps-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'weather-gaps-modal';
            modal.className = 'modal';
            modal.style.cssText = 'display:block; position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:1000;';
            document.body.appendChild(modal);
        }
        modal.style.display = 'block';
        modal.innerHTML = `<div class="modal-content" style="max-width:640px; margin:8% auto; background:#fff; border-radius:6px; padding:20px; max-height:75vh; overflow-y:auto;">
            <h3 style="margin-top:0;">${escapeHtml(title)}</h3>
            <div id="weather-gaps-body">Loading...</div>
        </div>`;
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    },

    // Interpolate short gaps in every year that has missing hours (station-wide
    // version of the per-year "Fill gaps by interpolation"). Explicit action,
    // every filled hour flagged is_interpolated; long gaps are skipped.
    interpolateAllMissing: async function() {
        const stationId = this.selectedStationId;
        if (!stationId) return;

        const targets = (this.weatherYearly || [])
            .filter(r => Number(r.incomplete_hours) > 0)
            .map(r => ({ year: parseInt(r.year, 10), hours: Number(r.incomplete_hours) }))
            .sort((a, b) => a.year - b.year);
        if (targets.length === 0) {
            alert('No missing hours to interpolate.');
            return;
        }
        const total = targets.reduce((s, t) => s + t.hours, 0);
        if (!confirm(`Interpolate missing hours for ${stationId}?\n\n`
            + `${total.toLocaleString()} incomplete hour(s) across ${targets.length} year(s): ${targets.map(t => t.year).join(', ')}.\n\n`
            + `Short gaps are filled and flagged as interpolated; long gaps are skipped.\n`
            + `Tip: run Update Data first so Frost supplies real values where it can.`)) {
            return;
        }

        this.openWeatherGapsModal(`Interpolate missing — ${stationId}`);
        const body = document.getElementById('weather-gaps-body');

        let filled = 0, patched = 0;
        const skipped = [];
        const errors = [];
        for (let i = 0; i < targets.length; i++) {
            const { year } = targets[i];
            if (body) body.textContent = `Interpolating ${year}... (${i + 1}/${targets.length})`;
            try {
                const resp = await fetch('./api/heataq_api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'fill_weather_gaps', station_id: stationId, year: year })
                });
                const data = await resp.json();
                if (data.error) throw new Error(data.error);
                filled += Number(data.filled_hours) || 0;
                patched += Number(data.patched_hours) || 0;
                (data.skipped_runs || []).forEach(r => skipped.push(r));
            } catch (err) {
                errors.push(`${year}: ${err.message}`);
            }
        }

        let html = `<p style="color: var(--success);">✓ Filled ${filled.toLocaleString()} missing hour(s),
            patched ${patched.toLocaleString()} NULL-field hour(s) across ${targets.length} year(s). All flagged as interpolated.</p>`;
        if (skipped.length > 0) {
            html += `<p style="color: var(--danger);">Skipped ${skipped.length} gap(s) too long to interpolate — re-fetch these instead:</p><ul style="font-size:12px;">`;
            skipped.slice(0, 50).forEach(r => { html += `<li>${escapeHtml(r.start)} → ${escapeHtml(r.end)} (${escapeHtml(r.hours)} h)</li>`; });
            if (skipped.length > 50) html += `<li>… and ${skipped.length - 50} more</li>`;
            html += '</ul>';
        }
        if (errors.length > 0) {
            html += `<p style="color: var(--danger);">Errors: ${escapeHtml(errors.join(' | '))}</p>`;
        }
        html += `<div style="margin-top:12px; text-align:right;">
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('weather-gaps-modal').style.display='none'">Close</button></div>`;
        if (body) body.innerHTML = html;

        // Refresh the yearly table so Missing/Filled columns update
        await this.onStationChange();
    },

    showWeatherGaps: async function(year) {
        const stationId = document.getElementById('weather-station-select')?.value;
        if (!stationId) return;

        this.openWeatherGapsModal(`Missing weather data — ${stationId}, ${year}`);

        const body = () => document.getElementById('weather-gaps-body');
        try {
            const resp = await fetch(`./api/heataq_api.php?action=get_weather_gaps&station_id=${encodeURIComponent(stationId)}&year=${year}`);
            const data = await resp.json();
            if (data.error) throw new Error(data.error);

            const runs = data.runs || [];
            let html = `<p style="font-size:13px; color:#555;">
                Expected ${escapeHtml(data.expected_hours)} h in the station's data range ·
                ${escapeHtml(data.missing_rows)} missing row(s) · ${escapeHtml(data.null_field_hours)} h with NULL fields</p>`;
            if (runs.length === 0) {
                html += '<p style="color: var(--success);">✓ No gaps in this year.</p>';
            } else {
                html += `<table class="data-table compact" style="width:100%;">
                    <thead><tr><th>From</th><th>To</th><th>Hours</th><th>Problem</th></tr></thead><tbody>`;
                runs.forEach(r => {
                    const what = r.kind === 'missing_rows' ? 'rows missing' : `NULL: ${r.fields.join(', ')}`;
                    html += `<tr><td>${escapeHtml(r.start)}</td><td>${escapeHtml(r.end)}</td><td style="text-align:right;">${escapeHtml(r.hours)}</td><td>${escapeHtml(what)}</td></tr>`;
                });
                html += '</tbody></table>';
                html += `<div style="margin-top:14px; padding:10px; background:#fff8e6; border:1px solid #e6c200; border-radius:4px; font-size:12px;">
                    Filling reconstructs values from the diurnal profile of ±3 neighbouring days,
                    blended to join the gap edges. Filled hours are permanently flagged
                    <code>is_interpolated</code> and never overwrite measured values.
                    Gaps longer than 7 days are refused (re-fetch instead).
                    Try <strong>Update Data</strong> (re-fetch from Frost) first — interpolation
                    is for hours the source genuinely lacks.</div>
                <div style="margin-top:12px; text-align:right;">
                    <button class="btn btn-secondary btn-sm" onclick="document.getElementById('weather-gaps-modal').style.display='none'">Close</button>
                    <button class="btn btn-primary btn-sm" onclick="app.admin.fillWeatherGaps(${escapeJsArg(stationId)}, ${escapeJsArg(year)})">Fill gaps by interpolation</button>
                </div>`;
            }
            body().innerHTML = html;
        } catch (err) {
            body().innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(err.message)}</p>`;
        }
    },

    fillWeatherGaps: async function(stationId, year) {
        const body = document.getElementById('weather-gaps-body');
        if (body) body.innerHTML = 'Filling gaps...';
        try {
            const resp = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'fill_weather_gaps', station_id: stationId, year: year })
            });
            const data = await resp.json();
            if (data.error) throw new Error(data.error);

            let html = `<p style="color: var(--success);">✓ Filled ${escapeHtml(data.filled_hours)} missing hour(s),
                patched ${escapeHtml(data.patched_hours)} NULL-field hour(s). All flagged as interpolated.</p>`;
            if (data.skipped_runs && data.skipped_runs.length > 0) {
                html += '<p style="color: var(--danger);">Skipped (too long to interpolate — re-fetch instead):</p><ul style="font-size:12px;">';
                data.skipped_runs.forEach(r => { html += `<li>${escapeHtml(r.start)} → ${escapeHtml(r.end)} (${escapeHtml(r.hours)} h)</li>`; });
                html += '</ul>';
            }
            html += `<div style="margin-top:12px; text-align:right;">
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('weather-gaps-modal').style.display='none'">Close</button></div>`;
            if (body) body.innerHTML = html;

            // Refresh the yearly table so Missing/Filled columns update
            await this.onStationChange();
        } catch (err) {
            if (body) body.innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(err.message)}</p>
                <div style="margin-top:12px; text-align:right;">
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('weather-gaps-modal').style.display='none'">Close</button></div>`;
        }
    },

    renderMonthlyAverages: function(data) {
        const container = document.getElementById('weather-monthly-averages');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<p class="text-muted">No data available</p>';
            return;
        }

        let html = `<table class="data-table compact">
            <thead><tr>
                <th>Month</th>
                <th>Avg °C</th>
                <th>Min °C</th>
                <th>Max °C</th>
                <th>Wind m/s</th>
                <th>Humidity %</th>
            </tr></thead><tbody>`;

        data.forEach(row => {
            html += `<tr>
                <td>${escapeHtml(row.month_name)}</td>
                <td>${escapeHtml(row.avg_temp)}</td>
                <td>${escapeHtml(row.min_temp)}</td>
                <td>${escapeHtml(row.max_temp)}</td>
                <td>${escapeHtml(row.avg_wind)}</td>
                <td>${escapeHtml(row.avg_humidity)}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    // ========================================
    // USER MANAGEMENT
    // ========================================

    projects: [],

    loadUsers: async function() {
        try {
            // Load users and projects in parallel
            const [usersRes, projectsRes] = await Promise.all([
                fetch('./api/heataq_api.php?action=get_users'),
                fetch('./api/heataq_api.php?action=get_projects')
            ]);
            const usersData = await usersRes.json();
            const projectsData = await projectsRes.json();

            if (usersData.users) {
                this.users = usersData.users;
                this.renderUsers();
            }
            if (projectsData.projects) {
                this.projects = projectsData.projects;
            }
        } catch (err) {
            console.error('Failed to load users:', err);
            const activeList = document.getElementById('active-users-list');
            if (activeList) activeList.innerHTML = '<p class="error">Failed to load users</p>';
        }
    },

    renderUsers: function() {
        const activeContainer = document.getElementById('active-users-list');
        const inactiveContainer = document.getElementById('inactive-users-list');

        // Split users by active status
        const activeUsers = this.users.filter(u => Number(u.is_active) !== 0);
        const inactiveUsers = this.users.filter(u => Number(u.is_active) === 0);

        // Render active users
        if (activeContainer) {
            if (activeUsers.length === 0) {
                activeContainer.innerHTML = '<p class="text-muted">No active users</p>';
            } else {
                activeContainer.innerHTML = this.renderUsersTable(activeUsers);
            }
        }

        // Render inactive users
        if (inactiveContainer) {
            if (inactiveUsers.length === 0) {
                inactiveContainer.innerHTML = '<p class="text-muted">No inactive users</p>';
            } else {
                inactiveContainer.innerHTML = this.renderUsersTable(inactiveUsers);
            }
        }
    },

    renderUsersTable: function(users) {
        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Email</th><th>Name</th><th>Role</th><th>Projects</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        users.forEach(user => {
            const roleLabel = { viewer: 'Viewer', operator: 'Operator', admin: 'Admin', owner: 'Owner' }[user.role] || '-';
            const projectNames = user.project_names || '-';
            html += `<tr>
                <td>${escapeHtml(user.email)}</td>
                <td>${escapeHtml(user.name || '-')}</td>
                <td>${roleLabel}</td>
                <td>${escapeHtml(projectNames)}</td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="app.admin.editUser(${escapeJsArg(user.user_id)})">Edit</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        return html;
    },

    addUser: function() {
        this.showUserForm(null);
    },

    editUser: function(userId) {
        const user = this.users.find(u => u.user_id === userId);
        if (user) {
            this.showUserForm(user);
        }
    },

    showUserForm: function(existingUser) {
        const isEdit = !!existingUser;
        // is_active arrives as 0/1 (or "0"/"1"); "0 !== false" used to show
        // every inactive user as Active, and saving re-activated them
        const userInactive = isEdit && Number(existingUser.is_active) === 0;
        const title = isEdit ? 'Edit User' : 'Add User';
        const userProjectIds = existingUser?.project_ids || [];

        // Build project checkboxes with aligned layout
        const projectCheckboxes = this.projects.map(p => `
            <label style="display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer;">
                <input type="checkbox" name="user-projects" value="${escapeHtml(p.project_id)}"
                    style="width: 16px; height: 16px; margin: 0; flex-shrink: 0;"
                    ${userProjectIds.includes(p.project_id) ? 'checked' : ''}>
                <span>${escapeHtml(p.project_name)}</span>
            </label>
        `).join('');

        const html = `
            <div class="modal-overlay" onclick="app.admin.closeUserForm()">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <h3>${title}</h3>
                    <form id="user-form">
                        <input type="hidden" id="user-id" value="${escapeHtml(existingUser?.user_id || '')}">

                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="user-email" class="form-control" required
                                value="${escapeHtml(existingUser?.email || '')}" ${isEdit ? 'readonly' : ''}>
                        </div>

                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="user-name" class="form-control"
                                value="${escapeHtml(existingUser?.name || '')}">
                        </div>

                        ${!isEdit ? `
                        <div class="form-group">
                            <label>Password</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="user-password" class="form-control" required
                                    placeholder="Click Generate or enter manually">
                                <button type="button" class="btn btn-secondary btn-sm" onclick="app.admin.generatePassword()">Generate</button>
                            </div>
                            <small class="text-muted">Password will be visible. User must change it on first login.</small>
                        </div>
                        ` : ''}

                        <div class="form-group">
                            <label>Role</label>
                            <select id="user-role" class="form-control" onchange="app.admin.toggleProjectsField()">
                                ${['viewer', 'operator', 'admin', 'owner'].map(r => `<option value="${r}" ${(existingUser?.role || 'operator') === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Status</label>
                            <select id="user-active" class="form-control">
                                <option value="1" ${!userInactive ? 'selected' : ''}>Active</option>
                                <option value="0" ${userInactive ? 'selected' : ''}>Inactive</option>
                            </select>
                        </div>

                        <div class="form-group" id="projects-field" style="${existingUser?.role === 'admin' ? 'display:none' : ''}">
                            <label>Assigned Projects</label>
                            <div style="max-height: 150px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px; background: #fafafa;">
                                ${projectCheckboxes || '<p class="text-muted">No projects available</p>'}
                            </div>
                            <small class="text-muted">Viewers, operators and owners can only access assigned projects; admins get all</small>
                        </div>

                        <div class="form-actions">
                            <button type="button" class="btn btn-secondary" onclick="app.admin.closeUserForm()">Cancel</button>
                            <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        const modalDiv = document.createElement('div');
        modalDiv.id = 'user-modal';
        modalDiv.innerHTML = html;
        document.body.appendChild(modalDiv);

        document.getElementById('user-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveUser();
        });
    },

    toggleProjectsField: function() {
        const role = document.getElementById('user-role').value;
        const projectsField = document.getElementById('projects-field');
        if (projectsField) {
            projectsField.style.display = role === 'admin' ? 'none' : '';
        }
    },

    /**
     * Generate a secure random password
     * Requirements: 12 chars, uppercase, lowercase, number, special char
     */
    generatePassword: function() {
        const length = 12;
        const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluded I, O (look like 1, 0)
        const lowercase = 'abcdefghjkmnpqrstuvwxyz'; // Excluded i, l, o
        const numbers = '23456789'; // Excluded 0, 1 (look like O, l)
        const special = '!@#$%&*';

        // Ensure at least one of each type
        let password = '';
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];
        password += special[Math.floor(Math.random() * special.length)];

        // Fill the rest with mixed characters
        const allChars = uppercase + lowercase + numbers + special;
        for (let i = password.length; i < length; i++) {
            password += allChars[Math.floor(Math.random() * allChars.length)];
        }

        // Shuffle the password
        password = password.split('').sort(() => Math.random() - 0.5).join('');

        // Set in the password field
        const field = document.getElementById('user-password');
        if (field) {
            field.value = password;
        }
    },

    closeUserForm: function() {
        const modal = document.getElementById('user-modal');
        if (modal) modal.remove();
    },

    saveUser: async function() {
        const id = document.getElementById('user-id').value;
        const role = document.getElementById('user-role').value;

        // Get selected projects (admins get every project server-side)
        const projectIds = [];
        if (role !== 'admin') {
            document.querySelectorAll('input[name="user-projects"]:checked').forEach(cb => {
                projectIds.push(parseInt(cb.value));
            });
        }

        const data = {
            action: 'save_user',
            user_id: id || null,
            email: document.getElementById('user-email').value,
            name: document.getElementById('user-name').value,
            role: role,
            project_ids: projectIds,
            is_active: parseInt(document.getElementById('user-active').value)
        };

        const passwordField = document.getElementById('user-password');
        if (passwordField) {
            data.password = passwordField.value;
        }

        try {
            const response = await fetch('./api/heataq_api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();

            if (result.success) {
                this.closeUserForm();
                this.loadUsers();
            } else {
                alert('Failed to save: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Failed to save user:', err);
            alert('Failed to save user');
        }
    },

    // ========================================
    // SYSTEM TOOLS
    // ========================================

    loadSystemInfo: async function() {
        try {
            // Get simulator version from API
            const response = await fetch('./api/simulation_api.php?action=get_version');
            const data = await response.json();

            if (data.version) {
                const simVer = document.getElementById('sys-simulator-ver');
                if (simVer) simVer.textContent = data.version;
            }
            if (data.php_version) {
                const phpVer = document.getElementById('sys-php-ver');
                if (phpVer) phpVer.textContent = data.php_version;
            }
        } catch (err) {
            console.error('Failed to load system info:', err);
        }
    },

    // ========================================
    // STORAGE (hourly result retention)
    // ========================================

    loadStorage: async function() {
        const info = document.getElementById('storage-info');
        const status = document.getElementById('storage-status');
        const btn = document.getElementById('storage-cleanup-btn');
        if (status) status.textContent = 'Reading table sizes...';
        try {
            const response = await fetch('./api/heataq_api.php?action=get_storage');
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

            const rows = data.tables.slice(0, 8).map(t => `<tr>
                <td>${escapeHtml(t.name)}</td>
                <td style="text-align:right;">${Number(t.approx_rows || 0).toLocaleString()}</td>
                <td style="text-align:right;">${escapeHtml(t.size_mb)} MB</td>
            </tr>`).join('');
            if (info) info.innerHTML = `
                <table class="data-table compact">
                    <thead><tr><th>Table</th><th style="text-align:right;">Rows (approx.)</th><th style="text-align:right;">Size</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                <p style="margin-top:6px;"><strong>Total: ${escapeHtml(data.total_mb)} MB</strong>.
                   ${data.runs_to_clean > 0
                        ? `${escapeHtml(data.runs_to_clean)} older run(s) still have hourly data that can be removed.`
                        : 'No old hourly data to remove.'}</p>`;
            if (btn) btn.style.display = data.runs_to_clean > 0 ? '' : 'none';
            if (status) status.textContent = '';
            this.storageRunsToClean = data.runs_to_clean;
        } catch (err) {
            if (status) status.innerHTML = `<span class="error">Could not read storage: ${escapeHtml(err.message)}</span>`;
        }
    },

    runStorageCleanup: async function() {
        const n = this.storageRunsToClean || 0;
        if (!confirm(`Remove the hourly data of ${n} older run(s)?\n\nTheir inputs, summary and daily results are kept (History, reports, charts, baselines). `
            + `Only the hour-by-hour Details go; they can be recreated by re-running. This cannot be undone.`)) {
            return;
        }
        const status = document.getElementById('storage-status');
        const btn = document.getElementById('storage-cleanup-btn');
        if (btn) btn.disabled = true;
        let runs = 0, rowsDeleted = 0;
        try {
            // Each call works ~20 s; repeat until nothing remains
            for (let round = 0; round < 200; round++) {
                const response = await fetch('./api/heataq_api.php?action=storage_cleanup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
                runs += data.runs_done;
                rowsDeleted += data.rows_deleted;
                if (status) status.textContent = `Removed hourly data of ${runs} run(s), ${rowsDeleted.toLocaleString()} rows` +
                    (data.remaining > 0 ? `... (${data.remaining} to go)` : '. Compacting done.');
                if (data.remaining === 0) break;
            }
        } catch (err) {
            if (status) status.innerHTML = `<span class="error">Clean-up stopped: ${escapeHtml(err.message)}</span>`;
        } finally {
            if (btn) btn.disabled = false;
        }
        await this.loadStorage();
    },

    // ========================================
    // ENGINE VERIFICATION (reference set, tests/reference)
    // ========================================

    REFERENCE_LAST_KEY: 'heataq_reference_last',

    loadReference: async function() {
        const info = document.getElementById('reference-info');
        const status = document.getElementById('reference-status');
        if (status) status.textContent = 'Loading...';
        try {
            const ref = await SimEngine.api('reference_info');
            this.reference = ref;
            const pct = (a, b) => {
                if (typeof a !== 'number' || typeof b !== 'number') return a === b ? '=' : `${escapeHtml(a)} → ${escapeHtml(b)}`;
                if (a === b) return '=';
                if (Math.abs(a) <= 1e-9) return `${a} → ${b}`;
                const p = 100 * (b - a) / Math.abs(a);
                return Math.abs(p) < 0.05 ? '≈0%' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
            };
            const changes = (ref.changes || []).map(c => {
                const v = c.values;
                return `<tr><td>${escapeHtml(c.title)}</td>
                    <td>${c.status === 'differs' ? 'changed' : 'unchanged'}</td>
                    <td style="text-align:right;">${pct(v.total_cost.from, v.total_cost.to)}</td>
                    <td style="text-align:right;">${pct(v.boiler_thermal_kwh.from, v.boiler_thermal_kwh.to)}</td>
                    <td style="text-align:right;">${pct(v.hp_thermal_kwh.from, v.hp_thermal_kwh.to)}</td>
                    <td style="text-align:right;">${escapeHtml(v.days_below_27.from)} → ${escapeHtml(v.days_below_27.to)}</td></tr>`;
            }).join('');
            const own = ref.compared_with === ref.engine_version;
            let last = null;
            try { last = JSON.parse(localStorage.getItem(this.REFERENCE_LAST_KEY) || 'null'); } catch (e) { /* none */ }
            if (info) info.innerHTML = `
                <p style="margin:4px 0;">Engine <strong>${escapeHtml(ref.engine_version)}</strong>.
                   Reference results stored for: ${ref.versions.map(escapeHtml).join(', ') || 'none'}.
                   ${own ? '' : `<br><span style="color:#b8860b;">No results stored for ${escapeHtml(ref.engine_version)} yet: it is checked against ${escapeHtml(ref.compared_with)}, so differences are expected.</span>`}</p>
                ${last ? `<p class="text-muted" style="margin:4px 0;">Last verified in this browser: ${escapeHtml(new Date(last.at).toLocaleString('en-GB'))}, engine ${escapeHtml(last.version)}: ${escapeHtml(last.text)}</p>` : ''}
                <table class="data-table compact" id="reference-table" style="margin-top:6px;">
                    <thead><tr><th>Scenario</th><th>Period</th><th>PHP (server)</th><th>TypeScript (browser)</th></tr></thead>
                    <tbody>${ref.scenarios.map(s => `<tr data-id="${escapeHtml(s.id)}">
                        <td title="${escapeHtml(s.description)}">${escapeHtml(s.title)}</td>
                        <td>${escapeHtml(s.start)} – ${escapeHtml(s.end)}</td>
                        <td class="ref-php">-</td><td class="ref-ts">-</td></tr>`).join('')}</tbody>
                </table>
                ${ref.previous_version && changes ? `
                <p style="margin:12px 0 4px;"><strong>What ${escapeHtml(ref.compared_with)} changed compared with ${escapeHtml(ref.previous_version)}</strong> (stored results)</p>
                <table class="data-table compact">
                    <thead><tr><th>Scenario</th><th></th><th style="text-align:right;">Cost</th><th style="text-align:right;">Boiler heat</th><th style="text-align:right;">HP heat</th><th style="text-align:right;">Days &gt;1 °C below</th></tr></thead>
                    <tbody>${changes}</tbody>
                </table>` : ''}`;
            if (status) status.textContent = '';
            return ref;
        } catch (err) {
            if (status) status.innerHTML = `<span class="error">Could not load the reference set: ${escapeHtml(err.message)}</span>`;
            return null;
        }
    },

    /** One comparison result as a table cell. */
    referenceCell: function(c, own) {
        if (!c) return '<span class="error">error</span>';
        if (c.error) return `<span class="error" title="${escapeHtml(c.error)}">error</span>`;
        const ms = c.ms !== undefined ? ` <span class="text-muted">${escapeHtml(c.ms)} ms</span>` : '';
        if (c.status === 'identical') return `<span style="color:#28a745;">✓ identical</span>${ms}`;
        if (c.status === 'rounding') return `<span style="color:#28a745;" title="Some values differ in the last rounded digit">✓ within rounding</span>${ms}`;
        const detail = `${c.summary_differing} summary values, ${c.days_differing} days (first ${c.first_day ?? '-'}), ${c.hours_differing} hours`
            + (c.summary_diffs || []).slice(0, 4).map(d => `\n${d.key}: ${d.expected} → ${d.got}`).join('');
        return `<span style="color:${own ? '#dc3545' : '#b8860b'};" title="${escapeHtml(detail)}">${own ? '✗ differs' : 'changed'}</span>${ms}`;
    },

    verifyEngine: async function() {
        const btn = document.getElementById('reference-verify-btn');
        const status = document.getElementById('reference-status');
        const ref = await this.loadReference();
        if (!ref) return;
        const own = ref.compared_with === ref.engine_version;
        if (btn) btn.disabled = true;
        let bad = 0, done = 0;
        const n = ref.scenarios.length;
        for (const s of ref.scenarios) {
            const row = document.querySelector(`#reference-table tr[data-id="${CSS.escape(s.id)}"]`);
            const php = row?.querySelector('.ref-php'), ts = row?.querySelector('.ref-ts');
            if (status) status.textContent = `Checking ${done + 1} of ${n}: ${s.title}...`;
            let p, t;
            if (php) php.textContent = 'running...';
            try { p = await SimEngine.api(`reference_check_php&id=${encodeURIComponent(s.id)}`); } catch (e) { p = { error: e.message }; }
            if (php) php.innerHTML = this.referenceCell(p, own);
            if (ts) ts.textContent = 'running...';
            try {
                const sc = await SimEngine.api(`reference_scenario&id=${encodeURIComponent(s.id)}`);
                t = await SimEngine.checkReference(sc.inputs, sc.expected);
            } catch (e) { t = { error: e.message }; }
            if (ts) ts.innerHTML = this.referenceCell(t, own);
            if (!p || p.error || p.status === 'differs' || !t || t.error || t.status === 'differs') bad++;
            done++;
        }
        const text = bad === 0
            ? `all ${n} scenarios match on both engines`
            : own ? `${bad} of ${n} scenarios differ` : `${bad} of ${n} scenarios changed compared with ${ref.compared_with}`;
        if (status) status.innerHTML = `<span style="color:${bad === 0 ? '#28a745' : own ? '#dc3545' : '#b8860b'};">${bad === 0 ? '✓' : own ? '✗' : '!'} ${escapeHtml(text[0].toUpperCase() + text.slice(1))}.</span>`;
        try {
            localStorage.setItem(this.REFERENCE_LAST_KEY, JSON.stringify({ at: Date.now(), version: ref.engine_version, text }));
        } catch (e) { /* private mode */ }
        if (btn) btn.disabled = false;
    },

    dumpSchema: async function(pushToGit = false) {
        const status = document.getElementById('schema-status');
        const result = document.getElementById('schema-result');
        const gitResult = document.getElementById('git-result');

        if (status) status.textContent = pushToGit ? 'Exporting and pushing...' : 'Exporting...';
        if (result) result.style.display = 'none';
        if (gitResult) gitResult.textContent = '';

        try {
            const response = await fetch('./api/heataq_api.php?action=dump_schema', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'dump_schema', push: pushToGit })
            });
            const data = await response.json();

            if (data.status === 'success') {
                if (status) status.textContent = `Done! ${data.tables} tables exported.`;
                if (result) result.style.display = 'block';

                if (data.git) {
                    if (data.git.pushed) {
                        if (gitResult) {
                            gitResult.innerHTML = `<strong style="color: green;">Pushed to branch: ${escapeHtml(data.git.branch)}</strong><br>
                                <small>You can now create a PR to merge this branch.</small>`;
                        }
                    } else {
                        if (gitResult) {
                            gitResult.innerHTML = `<strong style="color: red;">Git push failed</strong><br>
                                <small>${escapeHtml(data.git.output || 'Unknown error')}</small>`;
                        }
                    }
                }
            } else {
                if (status) status.textContent = 'Error: ' + (data.error || 'Unknown error');
            }
        } catch (err) {
            console.error('Schema dump failed:', err);
            if (status) status.textContent = 'Error: ' + err.message;
        }
    },

    dumpSchemaAndPush: async function() {
        await this.dumpSchema(true);
    },

    downloadSchema: async function() {
        try {
            const response = await fetch('./db/schema.json');
            const data = await response.json();

            // Create downloadable blob
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            // Trigger download
            const a = document.createElement('a');
            a.href = url;
            a.download = 'schema.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
            alert('Failed to download schema: ' + err.message);
        }
    },

    // ========================================
    // DEPLOYMENT
    // ========================================

    loadDeployStatus: async function() {
        const container = document.getElementById('deploy-status');
        if (!container) return;

        container.innerHTML = '<p>Loading deployment status...</p>';

        try {
            const response = await fetch('./api/heataq_api.php?action=deploy_status');
            const data = await response.json();

            if (data.error) {
                container.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
                return;
            }

            let html = '<table class="data-table compact">';
            html += `<tr><td><strong>Branch</strong></td><td>${escapeHtml(data.branch)}</td></tr>`;
            html += `<tr><td><strong>App Version</strong></td><td>${escapeHtml(data.app_version || 'Unknown')}</td></tr>`;
            html += `<tr><td><strong>Commit</strong></td><td><code>${escapeHtml(data.head_short)}</code></td></tr>`;
            html += `<tr><td><strong>Behind Origin</strong></td><td>${data.behind_origin > 0 ? `<span style="color:orange">${escapeHtml(data.behind_origin)} commits</span>` : '<span style="color:green">Up to date</span>'}</td></tr>`;
            html += `<tr><td><strong>Ahead of Origin</strong></td><td>${data.ahead_origin > 0 ? `<span style="color:blue">${escapeHtml(data.ahead_origin)} commits</span>` : '0'}</td></tr>`;
            html += '</table>';

            // Recent commits
            if (data.last_commits && data.last_commits.length > 0) {
                html += '<h4>Recent Commits</h4><ul class="commit-list">';
                data.last_commits.forEach(c => {
                    html += `<li><code>${escapeHtml(c)}</code></li>`;
                });
                html += '</ul>';
            }

            // Untracked/modified files
            if ((data.untracked_files && data.untracked_files.length > 0) ||
                (data.modified_files && data.modified_files.length > 0)) {
                html += '<h4>Local Changes</h4>';
                if (data.untracked_files && data.untracked_files.length > 0) {
                    html += '<p><strong>Untracked:</strong> ' + escapeHtml(data.untracked_files.join(', ')) + '</p>';
                }
                if (data.modified_files && data.modified_files.length > 0) {
                    html += '<p><strong>Modified:</strong> ' + escapeHtml(data.modified_files.join(', ')) + '</p>';
                }
            }

            // Actions
            html += '<div class="button-group" style="margin-top: 1rem;">';
            if (data.behind_origin > 0) {
                html += '<button class="btn btn-primary" onclick="AdminModule.deployPull()">Pull Updates</button>';
            }
            html += '<button class="btn" onclick="AdminModule.hardRefresh()">Refresh Page</button>';
            html += '</div>';

            // Show available branches to merge
            if (data.remote_branches && data.remote_branches.length > 0) {
                // Default to continue-work branch if available
                const defaultBranch = 'claude/continue-work-8dFhv';
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">';
                html += '<strong>Merge Branch:</strong> ';
                html += '<select id="merge-branch-select" style="margin: 0 0.5rem;">';
                data.remote_branches.forEach(b => {
                    const selected = b === defaultBranch ? 'selected' : '';
                    html += `<option value="${escapeHtml(b)}" ${selected}>${escapeHtml(b)}</option>`;
                });
                html += '</select>';
                html += '<button class="btn btn-primary" onclick="AdminModule.mergeBranch()">Merge & Deploy</button>';
                html += '</div>';
            }

            html += '<div id="deploy-log" style="margin-top: 1rem;"></div>';

            container.innerHTML = html;
        } catch (err) {
            console.error('Failed to load deploy status:', err);
            container.innerHTML = `<p class="error">Failed to load: ${escapeHtml(err.message)}</p>`;
        }
    },

    hardRefresh: function() {
        // Force reload bypassing cache
        window.location.reload(true);
    },

    mergeBranch: async function() {
        const select = document.getElementById('merge-branch-select');
        if (!select || !select.value) {
            alert('Select a branch to merge');
            return;
        }

        const branch = select.value;
        if (!confirm(`Merge "${branch}" into main and deploy?`)) {
            return;
        }

        const logContainer = document.getElementById('deploy-log');
        if (logContainer) {
            logContainer.innerHTML = `<p>Merging ${escapeHtml(branch)}...</p>`;
        }

        try {
            const response = await fetch('./api/heataq_api.php?action=merge_branch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch: branch })
            });
            const data = await response.json();

            if (data.error) {
                if (logContainer) logContainer.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
                return;
            }

            let html = '<div class="deploy-result">';
            html += `<p><strong>Result:</strong> ${data.success ? '<span style="color:green">Success</span>' : '<span style="color:red">Failed</span>'}</p>`;
            if (data.log) {
                html += '<pre class="deploy-log">';
                data.log.forEach(line => { html += escapeHtml(line) + '\n'; });
                html += '</pre>';
            }
            html += '</div>';

            if (logContainer) logContainer.innerHTML = html;

            // Auto reload on success
            if (data.success) {
                setTimeout(() => window.location.reload(true), 1500);
            }
        } catch (err) {
            console.error('Merge failed:', err);
            if (logContainer) logContainer.innerHTML = `<p class="error">Failed: ${escapeHtml(err.message)}</p>`;
        }
    },

    deployPull: async function() {
        const logContainer = document.getElementById('deploy-log');
        if (logContainer) {
            logContainer.innerHTML = '<p>Pulling updates...</p>';
        }

        try {
            const response = await fetch('./api/heataq_api.php?action=deploy_pull', { method: 'POST' });
            const data = await response.json();

            if (data.error) {
                if (logContainer) logContainer.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
                return;
            }

            let html = '<div class="deploy-result">';
            html += `<p><strong>Result:</strong> ${data.success ? '<span style="color:green">Success</span>' : '<span style="color:red">Failed</span>'}</p>`;
            html += `<p><strong>Version:</strong> ${escapeHtml(data.app_version)}</p>`;
            html += `<p><strong>Commit:</strong> <code>${escapeHtml(data.head)}</code></p>`;
            html += '<h4>Log</h4><pre class="deploy-log">';
            data.log.forEach(line => {
                html += escapeHtml(line) + '\n';
            });
            html += '</pre>';
            html += '<p><strong>Refresh the page to see changes.</strong></p>';
            html += '</div>';

            if (logContainer) logContainer.innerHTML = html;
        } catch (err) {
            console.error('Deploy pull failed:', err);
            if (logContainer) logContainer.innerHTML = `<p class="error">Failed: ${escapeHtml(err.message)}</p>`;
        }
    },

    // ====================================
    // DATABASE MIGRATIONS
    // ====================================

    checkMigrations: async function() {
        console.log('checkMigrations: starting');
        const listEl = document.getElementById('migrations-list');
        const resultEl = document.getElementById('migration-result');

        if (!listEl) {
            console.error('checkMigrations: migrations-list element not found');
            return;
        }

        listEl.innerHTML = '<p class="text-muted">Checking...</p>';
        if (resultEl) resultEl.innerHTML = '';

        try {
            console.log('checkMigrations: fetching...');
            const response = await fetch('./api/heataq_api.php?action=check_migrations');
            console.log('checkMigrations: response status', response.status);

            if (!response.ok) {
                listEl.innerHTML = `<p class="error">API error: ${response.status}</p>`;
                return;
            }

            const data = await response.json();
            console.log('checkMigrations: data', data);

            if (data.error) {
                listEl.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
                return;
            }

            const pending = data.pending || [];

            if (pending.length === 0) {
                if (listEl) listEl.innerHTML = '<p style="color: green;">✓ No pending migrations</p>';
                return;
            }

            let html = '<table class="data-table compact"><thead><tr>';
            html += '<th>File</th><th>Description</th><th></th>';
            html += '</tr></thead><tbody>';

            pending.forEach(m => {
                const rowId = 'row-migrate-' + m.filename.replace(/[^a-z0-9]/gi, '-');
                const descId = 'desc-migrate-' + m.filename.replace(/[^a-z0-9]/gi, '-');
                const actionsId = 'actions-migrate-' + m.filename.replace(/[^a-z0-9]/gi, '-');
                html += `<tr id="${rowId}">`;
                html += `<td><code>${escapeHtml(m.filename)}</code></td>`;

                // Show log link if log file exists
                if (m.has_log && m.log_file) {
                    const logColor = m.log_success ? 'green' : 'red';
                    const logIcon = m.log_success ? '✓' : '✗';
                    html += `<td id="${descId}"><a href="db/migrations/${escapeHtml(m.log_file)}" target="_blank" style="color: ${logColor};">${logIcon} View log</a></td>`;
                } else {
                    html += `<td id="${descId}">${escapeHtml(m.description || '-')}</td>`;
                }

                // Show Done + Archive if log exists and was successful
                // Show Run + Archive if log exists but failed (can re-run or archive)
                // Show Run only if no log exists
                if (m.has_log) {
                    if (m.log_success) {
                        html += `<td id="${actionsId}">
                            <button class="btn btn-sm btn-success" disabled>✓ Done</button>
                            <button class="btn btn-sm btn-secondary" onclick="AdminModule.archiveMigration(${escapeJsArg(m.filename)})" style="margin-left: 5px;">Archive</button>
                        </td>`;
                    } else {
                        html += `<td id="${actionsId}">
                            <button class="btn btn-sm btn-primary" onclick="AdminModule.runMigration(${escapeJsArg(m.filename)}, this)">Run</button>
                            <button class="btn btn-sm btn-secondary" onclick="AdminModule.archiveMigration(${escapeJsArg(m.filename)})" style="margin-left: 5px;">Archive</button>
                        </td>`;
                    }
                } else {
                    html += `<td id="${actionsId}"><button class="btn btn-sm btn-primary" onclick="AdminModule.runMigration(${escapeJsArg(m.filename)}, this)">Run</button></td>`;
                }
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (listEl) listEl.innerHTML = html;

        } catch (err) {
            console.error('Check migrations failed:', err);
            if (listEl) listEl.innerHTML = `<p class="error">Failed to check: ${escapeHtml(err.message)}</p>`;
        }
    },

    runMigration: async function(filename, btn) {
        const resultEl = document.getElementById('migration-result');
        if (resultEl) resultEl.innerHTML = `<p>Running ${escapeHtml(filename)}...</p>`;

        // Disable button and show running state
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Running...';
            btn.style.backgroundColor = '#6c757d';
        }

        try {
            const response = await fetch('./api/heataq_api.php?action=run_migration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: filename })
            });

            if (!response.ok) {
                // Show the server's reason (permission, missing session header,
                // cross-site check...), not just the status code
                const errBody = await response.json().catch(() => ({}));
                if (resultEl) resultEl.innerHTML = `<p class="error">API error ${response.status}: ${escapeHtml(errBody.error || errBody.message || response.statusText || 'request refused')}</p>`;
                if (btn) {
                    btn.textContent = '✗ Error';
                    btn.style.backgroundColor = '#dc3545';
                    btn.disabled = false;
                }
                return;
            }

            const data = await response.json();
            console.log('Migration result:', data);

            // Find the row elements
            const descId = 'desc-migrate-' + filename.replace(/[^a-z0-9]/gi, '-');
            const actionsId = 'actions-migrate-' + filename.replace(/[^a-z0-9]/gi, '-');
            const descEl = document.getElementById(descId);
            const actionsEl = document.getElementById(actionsId);

            // Log file link
            const logFile = data.log_file || filename.replace('.sql', data.success ? '_log.txt' : '_error.txt');

            let resultHtml = '';
            if (data.success) {
                resultHtml += `<p style="color: green; font-weight: bold;">✓ SUCCESS: ${escapeHtml(filename)}</p>`;
                resultHtml += `<p>${escapeHtml(data.statements)} statements executed</p>`;
                if (data.tables_created && data.tables_created.length > 0) {
                    resultHtml += `<p>Tables: ${escapeHtml(data.tables_created.join(', '))}</p>`;
                }

                // Update description to log link
                if (descEl) {
                    descEl.innerHTML = `<a href="db/migrations/${escapeHtml(logFile)}" target="_blank" style="color: green;">✓ View log</a>`;
                }

                // Update actions: green Done button + Archive button
                if (actionsEl) {
                    actionsEl.innerHTML = `
                        <button class="btn btn-sm" style="background-color: #28a745; color: white;" disabled>✓ Done</button>
                        <button class="btn btn-sm btn-secondary" onclick="AdminModule.archiveMigration(${escapeJsArg(filename)})" style="margin-left: 5px;">Archive</button>
                    `;
                }
            } else {
                resultHtml += `<p style="color: red; font-weight: bold;">✗ FAILED: ${escapeHtml(filename)}</p>`;
                resultHtml += `<p class="error">${escapeHtml(data.error || 'Unknown error')}</p>`;

                // Update description to error log link
                if (descEl) {
                    descEl.innerHTML = `<a href="db/migrations/${escapeHtml(logFile)}" target="_blank" style="color: red;">✗ View error log</a>`;
                }

                // Red button, allow retry
                if (btn) {
                    btn.textContent = '✗ Retry';
                    btn.style.backgroundColor = '#dc3545';
                    btn.disabled = false;
                }
            }

            // Expandable log in result area
            if (data.log && data.log.length > 0) {
                resultHtml += '<details><summary>Show log output</summary><pre class="deploy-log" style="max-height: 200px; overflow: auto; font-size: 11px;">';
                data.log.forEach(line => { resultHtml += escapeHtml(line) + '\n'; });
                resultHtml += '</pre></details>';
            }

            if (resultEl) resultEl.innerHTML = resultHtml;

        } catch (err) {
            console.error('Run migration failed:', err);
            if (resultEl) resultEl.innerHTML = `<p class="error">Failed: ${escapeHtml(err.message)}</p>`;
            if (btn) {
                btn.textContent = '✗ Error';
                btn.style.backgroundColor = '#dc3545';
                btn.disabled = false;
            }
        }
    },

    archiveMigration: async function(filename) {
        const resultEl = document.getElementById('migration-result');
        const rowId = 'row-migrate-' + filename.replace(/[^a-z0-9]/gi, '-');
        const row = document.getElementById(rowId);

        if (resultEl) resultEl.innerHTML = `<p>Archiving ${escapeHtml(filename)}...</p>`;

        try {
            const response = await fetch('./api/heataq_api.php?action=archive_migration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: filename })
            });

            const data = await response.json();
            console.log('Archive result:', data);

            if (data.success) {
                // Remove the row from the table
                if (row) {
                    row.style.transition = 'opacity 0.3s';
                    row.style.opacity = '0';
                    setTimeout(() => row.remove(), 300);
                }

                if (resultEl) {
                    let html = `<p style="color: green; font-weight: bold;">✓ Archived ${escapeHtml(filename)}</p>`;
                    html += '<ul style="margin: 0.5rem 0; padding-left: 1.5rem; color: #666;">';
                    html += '<li>Moved to old_migrations/</li>';
                    html += '<li>Schema exported</li>';
                    html += `<li>Pushed to GitHub: ${data.pushed ? '✓' : '⚠ check manually'}</li>`;
                    html += '</ul>';
                    resultEl.innerHTML = html;
                }
            } else {
                if (resultEl) {
                    resultEl.innerHTML = `<p class="error">Archive failed: ${escapeHtml(data.error || 'Unknown error')}</p>`;
                }
            }
        } catch (err) {
            console.error('Archive migration failed:', err);
            if (resultEl) resultEl.innerHTML = `<p class="error">Archive failed: ${escapeHtml(err.message)}</p>`;
        }
    },

    // ========================================
    // DEBUG MODE
    // ========================================

    /**
     * Toggle debug mode - shows/hides Debug tab in Simulations
     * Setting is stored in user preferences
     */
    toggleDebugMode: function(enabled) {
        // Store in localStorage
        localStorage.setItem('heataq_debug_mode', enabled ? '1' : '0');

        // Update UI immediately
        this.applyDebugMode(enabled);

        // Sync to server preferences
        SimControlModule.savePreference('debug_mode', enabled ? '1' : '0');

        console.log('Debug mode:', enabled ? 'enabled' : 'disabled');
    },

    /**
     * Apply debug mode visibility
     * Toggles body class to show/hide .debug-only elements via CSS
     */
    applyDebugMode: function(enabled) {
        console.log('applyDebugMode:', enabled);
        if (enabled) {
            document.body.classList.add('debug-mode-on');
        } else {
            document.body.classList.remove('debug-mode-on');
        }
    },

    /**
     * Initialize debug mode on page load (called from app.js)
     */
    initDebugMode: function() {
        console.log('initDebugMode called, isAdmin:', app.isAdmin());

        // Only admins can use debug mode
        if (!app.isAdmin()) {
            this.applyDebugMode(false);
            return;
        }

        // Check stored preference
        const stored = localStorage.getItem('heataq_debug_mode');
        const enabled = stored === '1';
        console.log('Debug mode stored value:', stored, 'enabled:', enabled);

        // Update checkbox
        const toggle = document.getElementById('debug-mode-toggle');
        if (toggle) {
            toggle.checked = enabled;
        }

        // Apply visibility
        this.applyDebugMode(enabled);
    }
};

// Export for use in app
window.AdminModule = AdminModule;
