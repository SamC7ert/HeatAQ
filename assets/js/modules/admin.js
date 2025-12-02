// Admin module - Handles admin functionality (Exception Days, Weather Stations, Users)

const AdminModule = {
    // Current data
    holidayDefinitions: [],
    referenceDays: [],
    weatherStations: [],
    users: [],

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
                `<option value="${rd.id}" ${rd.id == def.reference_day_id ? 'selected' : ''}>${rd.name}</option>`
            ).join('');

            html += `<tr data-id="${def.id}">
                <td><input type="text" class="inline-edit" value="${def.name || ''}"
                    onchange="app.admin.updateHolidayField('${def.id}', 'name', this.value)"></td>
                <td><select class="inline-edit" onchange="app.admin.updateHolidayType('${def.id}', this.value)">
                    <option value="fixed" ${isFixed ? 'selected' : ''}>Fixed</option>
                    <option value="relative" ${!isFixed ? 'selected' : ''}>Relative</option>
                </select></td>
                <td>${isFixed
                    ? `<input type="date" class="inline-edit" value="2000-${dateValue}"
                        onchange="app.admin.updateHolidayDate('${def.id}', this.value)">`
                    : `<input type="number" class="inline-edit" style="width:50px" value="${def.offset_days || 0}"
                        onchange="app.admin.updateHolidayField('${def.id}', 'offset_days', this.value)">
                       <span style="margin:0 4px">days from</span>
                       <select class="inline-edit" onchange="app.admin.updateHolidayField('${def.id}', 'reference_day_id', this.value)">
                        ${refOptions}
                       </select>`
                }</td>
                <td><button class="btn btn-xs btn-danger" onclick="app.admin.deleteHolidayDefinition('${def.id}')" title="Delete">×</button></td>
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
        await this.saveHolidayInline(def);
        this.renderHolidayDefinitions(); // Re-render to show correct fields
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
            const result = await response.json();
            if (!result.success) {
                console.error('Failed to save:', result.error);
            }
        } catch (err) {
            console.error('Failed to save:', err);
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
            `<option value="${rd.id}" ${rd.id == existingDef?.reference_day_id ? 'selected' : ''}>${rd.name}</option>`
        ).join('');

        const html = `
            <div class="modal-overlay" onclick="app.admin.closeHolidayForm()">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <h3>${title}</h3>
                    <form id="holiday-form">
                        <input type="hidden" id="holiday-id" value="${existingDef?.id || ''}">

                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="holiday-name" class="form-control" required
                                value="${existingDef?.name || ''}" placeholder="e.g., Langfredag">
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
                                        value="${existingDef?.fixed_day || 1}">
                                </div>
                                <div class="form-group">
                                    <label>Month</label>
                                    <input type="number" id="holiday-month" class="form-control" min="1" max="12"
                                        value="${existingDef?.fixed_month || 1}">
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
                                    value="${existingDef?.offset_days || 0}">
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
            const response = await fetch(`./api/heataq_api.php?action=delete_holiday_definition&id=${encodeURIComponent(id)}`);
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
                this.referenceDays = data.reference_days;
                this.renderReferenceDays();
            }
        } catch (err) {
            console.error('Failed to load reference days:', err);
        }
    },

    renderReferenceDays: function() {
        const container = document.getElementById('reference-days-list');
        if (!container) return;

        if (this.referenceDays.length === 0) {
            container.innerHTML = '<p class="text-muted">No reference days</p>';
            return;
        }

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Year</th><th>1. påskedag</th>' +
            '</tr></thead><tbody>';

        this.referenceDays.forEach(ref => {
            html += `<tr>
                <td>${ref.year}</td>
                <td>${ref.easter_date}</td>
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
                    `<p class="error">Error: ${stationsData.error}</p>`;
                return;
            }

            if (stationsData.stations) {
                this.weatherStations = stationsData.stations;
                this.renderWeatherStations();
                this.populateStationDropdown();
                // Don't load data until station is selected
            }
        } catch (err) {
            console.error('Failed to load weather stations:', err);
            const container = document.getElementById('weather-stations-list');
            if (container) {
                container.innerHTML = '<p class="error">Failed to load weather stations</p>';
            }
        }
    },

    populateStationDropdown: function() {
        const select = document.getElementById('weather-station-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- Select Station --</option>' +
            this.weatherStations.map(s =>
                `<option value="${s.station_id}">${s.name}</option>`
            ).join('');
    },

    onStationChange: async function() {
        const select = document.getElementById('weather-station-select');
        this.selectedStationId = select ? select.value : '';

        const detailsDiv = document.getElementById('station-details');
        const noStationMsg = document.getElementById('no-station-message');
        const updateDataBtn = document.getElementById('update-data-btn');

        if (this.selectedStationId) {
            // Show station details and update data button
            if (detailsDiv) detailsDiv.style.display = 'block';
            if (noStationMsg) noStationMsg.style.display = 'none';
            if (updateDataBtn) updateDataBtn.style.display = 'inline-block';

            // Populate fields from station data
            const station = this.weatherStations.find(s => s.station_id === this.selectedStationId);
            if (station) {
                // Location with Google Maps link
                const locationEl = document.getElementById('station-location');
                if (locationEl && station.latitude && station.longitude) {
                    locationEl.innerHTML = `<a href="#" onclick="app.admin.openGoogleMaps(${station.latitude}, ${station.longitude}); return false;" style="color: var(--primary);">📍 ${parseFloat(station.latitude).toFixed(4)}, ${parseFloat(station.longitude).toFixed(4)}</a>`;
                } else if (locationEl) {
                    locationEl.textContent = '-';
                }

                // Editable fields
                const windHeightEl = document.getElementById('station-wind-height');
                const roughnessEl = document.getElementById('station-roughness');
                if (windHeightEl) windHeightEl.value = station.measurement_height_wind || 10;
                if (roughnessEl) roughnessEl.value = station.terrain_roughness || 0.03;
            }
        } else {
            // Hide details and button when no station selected
            if (detailsDiv) detailsDiv.style.display = 'none';
            if (noStationMsg) noStationMsg.style.display = 'block';
            if (updateDataBtn) updateDataBtn.style.display = 'none';
        }

        await this.loadWeatherData();
    },

    loadWeatherData: async function() {
        // Only load data if a station is selected
        if (!this.selectedStationId) {
            // Clear the data displays
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
                ? `<a href="#" onclick="app.admin.openGoogleMaps(${lat}, ${lon}); return false;" title="Open in Google Maps" style="color: var(--primary);">📍 ${parseFloat(lat).toFixed(4)}, ${parseFloat(lon).toFixed(4)}</a>`
                : '-';

            const windHeight = station.measurement_height_wind ? `${station.measurement_height_wind}m` : '10m';
            const roughness = station.terrain_roughness ?? '0.03';

            html += `<tr>
                <td>${station.name}</td>
                <td><code>${station.station_id}</code></td>
                <td>${locationHtml}</td>
                <td>${windHeight}</td>
                <td>${roughness}</td>
                <td>
                    <button class="btn btn-xs btn-primary" onclick="app.admin.editWeatherStation('${station.station_id}')">Edit</button>
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
                        <input type="text" class="form-control" value="${existingStation.station_id}" disabled>
                    </div>
                    `}
                    <div class="form-group">
                        <label>Station Name</label>
                        <input type="text" id="station-name-input" class="form-control" value="${existingStation?.name || ''}" placeholder="Station name">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Latitude</label>
                            <input type="number" id="station-lat-input" class="form-control" value="${existingStation?.latitude || ''}" step="0.0001" placeholder="58.3397">
                        </div>
                        <div class="form-group">
                            <label>Longitude</label>
                            <input type="number" id="station-lon-input" class="form-control" value="${existingStation?.longitude || ''}" step="0.0001" placeholder="8.5194">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Elevation (m)</label>
                            <input type="number" id="station-elevation-input" class="form-control" value="${existingStation?.elevation || ''}" placeholder="7">
                        </div>
                        <div class="form-group">
                            <label>Wind Height (m)</label>
                            <input type="number" id="station-wind-height-input" class="form-control" value="${existingStation?.measurement_height_wind || '10'}" step="0.1" placeholder="10">
                        </div>
                        <div class="form-group">
                            <label>Roughness (z₀)</label>
                            <input type="number" id="station-roughness-input" class="form-control" value="${existingStation?.terrain_roughness || '0.03'}" step="0.001" placeholder="0.03">
                            <small class="text-muted">0.03=open, 0.1=suburban</small>
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
                        ${isEdit ? `<button class="btn btn-danger" onclick="app.admin.deleteWeatherStation('${existingStation.station_id}')" style="margin-right: auto;">Delete</button>` : ''}
                        <button class="btn btn-primary" onclick="app.admin.saveStation('${existingStation?.station_id || ''}')">${isEdit ? 'Save' : '+ Add Station'}</button>
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
                    <div style="color: var(--success); font-weight: 500; margin-bottom: 8px;">✓ Station Found: ${data.name}</div>
                    <table class="data-table compact" style="font-size: 12px;">
                        <tr><td>Location</td><td>${data.latitude?.toFixed(4) || '-'}°N, ${data.longitude?.toFixed(4) || '-'}°E, ${data.elevation || '-'}m</td></tr>
                        <tr><td>Municipality</td><td>${data.municipality || '-'}, ${data.county || '-'}</td></tr>
                        <tr><td>Data Range</td><td>${dateRange.from || '?'} → ${dateRange.to || 'now'}</td></tr>
                        <tr><td>Elements</td><td>
                            temp ${elements.air_temperature ? '✓' : '✗'} |
                            wind ${elements.wind_speed ? '✓' : '✗'} |
                            humidity ${elements.relative_humidity ? '✓' : '✗'} |
                            solar ${elements.solar ? '✓' : '✗'}
                        </td></tr>
                        ${windLevels.length > 0 ? `<tr><td>Wind Levels</td><td>${windLevels.map(l => l + 'm').join(', ')}</td></tr>` : ''}
                    </table>
                `;
            } else {
                resultDiv.innerHTML = `<div style="color: var(--danger);">✗ Station not found: ${data.error || 'Unknown error'}</div>`;
            }
        } catch (err) {
            resultDiv.innerHTML = `<div style="color: var(--danger);">✗ Error checking station: ${err.message}</div>`;
        }
    },

    saveStation: async function(existingId) {
        const isEdit = !!existingId;
        const stationId = isEdit ? existingId : document.getElementById('station-id-input')?.value.trim();
        const name = document.getElementById('station-name-input')?.value.trim();
        const latitude = document.getElementById('station-lat-input')?.value;
        const longitude = document.getElementById('station-lon-input')?.value;
        const elevation = document.getElementById('station-elevation-input')?.value;
        const windHeight = document.getElementById('station-wind-height-input')?.value || '10';
        const roughness = document.getElementById('station-roughness-input')?.value || '0.03';

        // Get fetch options (only for new stations)
        const shouldFetch = !isEdit && document.getElementById('station-fetch-data')?.checked;
        const fetchStart = document.getElementById('station-fetch-start')?.value;
        const fetchEnd = document.getElementById('station-fetch-end')?.value;

        if (!stationId || !name) {
            alert('Station ID and Name are required');
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

        // Create modal with loading state
        let html = `
            <div class="modal-overlay" onclick="app.admin.closeStationModal()">
                <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 500px;">
                    <h3>Update Weather Data - ${station.name}</h3>
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
                    <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Close</button>
                `;
                return;
            }

            // Get current data info from the displayed values
            const currentDateRange = document.getElementById('weather-date-range')?.textContent || '-';
            const currentRecordCount = document.getElementById('weather-record-count')?.textContent || '0';

            // Determine date range
            const frostDateRange = frostData.data_range || {};
            const today = new Date().toISOString().split('T')[0];
            const frostStart = frostDateRange.from ? frostDateRange.from.split('T')[0] : '2015-01-01';
            const frostEnd = frostDateRange.to ? frostDateRange.to.split('T')[0] : today;

            // Default to fetching from 2015 or station start (whichever is later) to today
            const defaultStart = frostStart > '2015-01-01' ? frostStart : '2015-01-01';
            const defaultEnd = frostEnd > today ? today : frostEnd;

            contentDiv.innerHTML = `
                <table class="data-table compact" style="font-size: 13px; margin-bottom: 15px;">
                    <tr><td style="width: 140px;">Current Data</td><td>${currentDateRange} (${currentRecordCount})</td></tr>
                    <tr><td>Frost API Range</td><td>${frostStart} → ${frostEnd}</td></tr>
                </table>
                <div class="form-row" style="margin-bottom: 15px;">
                    <div class="form-group">
                        <label>Fetch From</label>
                        <input type="date" id="update-fetch-start" class="form-control" value="${defaultStart}">
                    </div>
                    <div class="form-group">
                        <label>To</label>
                        <input type="date" id="update-fetch-end" class="form-control" value="${defaultEnd}">
                    </div>
                </div>
                <p class="text-muted" style="font-size: 12px; margin-bottom: 15px;">
                    Existing records will be skipped (no duplicates created).
                </p>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="app.admin.startUpdateDataFetch()">Fetch Data</button>
                </div>
            `;
        } catch (err) {
            const contentDiv = document.getElementById('update-data-content');
            if (contentDiv) {
                contentDiv.innerHTML = `
                    <p style="color: var(--danger);">Error checking Frost API: ${err.message}</p>
                    <button class="btn btn-secondary" onclick="app.admin.closeStationModal()">Close</button>
                `;
            }
        }
    },

    // Start fetching data from the update modal
    startUpdateDataFetch: async function() {
        const startDate = document.getElementById('update-fetch-start')?.value;
        const endDate = document.getElementById('update-fetch-end')?.value;

        if (!startDate || !endDate) {
            alert('Please select a date range');
            return;
        }

        await this.fetchWeatherDataForStation(this.selectedStationId, startDate, endDate);
    },

    // Fetch weather data year by year with progress
    fetchWeatherDataForStation: async function(stationId, startDate, endDate) {
        const startYear = parseInt(startDate.split('-')[0]);
        const endYear = parseInt(endDate.split('-')[0]);
        const years = [];
        for (let y = startYear; y <= endYear; y++) {
            years.push(y);
        }

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

        for (let i = 0; i < years.length; i++) {
            const year = years[i];
            const progress = Math.round(((i) / years.length) * 100);

            if (statusEl) statusEl.textContent = `Fetching ${year}... (${i + 1}/${years.length})`;
            if (progressBar) progressBar.style.width = progress + '%';

            try {
                const response = await fetch(`./api/frost_api.php?action=fetch_and_store_year&station_id=${encodeURIComponent(stationId)}&year=${year}`);
                const data = await response.json();

                if (data.error) {
                    errors.push(`${year}: ${data.error}`);
                    if (detailsEl) detailsEl.textContent = `${year}: Error - ${data.error}`;
                } else {
                    totalInserted += data.inserted || 0;
                    totalSkipped += data.skipped || 0;
                    if (detailsEl) detailsEl.textContent = `${year}: ${data.inserted || 0} inserted, ${data.skipped || 0} skipped`;
                }
            } catch (err) {
                errors.push(`${year}: ${err.message}`);
                if (detailsEl) detailsEl.textContent = `${year}: Error - ${err.message}`;
            }
        }

        // Show completion
        if (progressBar) progressBar.style.width = '100%';
        if (statusEl) {
            if (errors.length > 0) {
                statusEl.innerHTML = `<span style="color: var(--warning);">Completed with ${errors.length} error(s)</span>`;
            } else {
                statusEl.innerHTML = `<span style="color: var(--success);">✓ Completed successfully!</span>`;
            }
        }
        if (detailsEl) {
            detailsEl.textContent = `Total: ${totalInserted.toLocaleString()} records inserted, ${totalSkipped.toLocaleString()} skipped`;
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

        // Reload weather stations to update counts
        await this.loadWeatherStations();
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

        const windHeight = document.getElementById('station-wind-height')?.value || '10';
        const roughness = document.getElementById('station-roughness')?.value || '0.03';

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
            </tr></thead><tbody>`;

        data.forEach(row => {
            html += `<tr>
                <td>${row.year}</td>
                <td>${row.avg_temp}</td>
                <td>${row.min_temp}</td>
                <td>${row.max_temp}</td>
                <td>${row.avg_wind}</td>
                <td>${row.avg_humidity}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
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
                <td>${row.month_name}</td>
                <td>${row.avg_temp}</td>
                <td>${row.min_temp}</td>
                <td>${row.max_temp}</td>
                <td>${row.avg_wind}</td>
                <td>${row.avg_humidity}</td>
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
        const activeUsers = this.users.filter(u => u.is_active);
        const inactiveUsers = this.users.filter(u => !u.is_active);

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
            const roleLabel = user.role === 'admin' ? 'Admin' : 'Operator';
            const projectNames = user.project_names || '-';
            html += `<tr>
                <td>${user.email}</td>
                <td>${user.name || '-'}</td>
                <td>${roleLabel}</td>
                <td>${projectNames}</td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="app.admin.editUser(${user.user_id})">Edit</button>
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
        const title = isEdit ? 'Edit User' : 'Add User';
        const userProjectIds = existingUser?.project_ids || [];

        // Build project checkboxes with aligned layout
        const projectCheckboxes = this.projects.map(p => `
            <label style="display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer;">
                <input type="checkbox" name="user-projects" value="${p.project_id}"
                    style="width: 16px; height: 16px; margin: 0; flex-shrink: 0;"
                    ${userProjectIds.includes(p.project_id) ? 'checked' : ''}>
                <span>${p.project_name}</span>
            </label>
        `).join('');

        const html = `
            <div class="modal-overlay" onclick="app.admin.closeUserForm()">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <h3>${title}</h3>
                    <form id="user-form">
                        <input type="hidden" id="user-id" value="${existingUser?.user_id || ''}">

                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="user-email" class="form-control" required
                                value="${existingUser?.email || ''}" ${isEdit ? 'readonly' : ''}>
                        </div>

                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="user-name" class="form-control"
                                value="${existingUser?.name || ''}">
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
                                <option value="operator" ${existingUser?.role !== 'admin' ? 'selected' : ''}>Operator</option>
                                <option value="admin" ${existingUser?.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Status</label>
                            <select id="user-active" class="form-control">
                                <option value="1" ${existingUser?.is_active !== false ? 'selected' : ''}>Active</option>
                                <option value="0" ${existingUser?.is_active === false ? 'selected' : ''}>Inactive</option>
                            </select>
                        </div>

                        <div class="form-group" id="projects-field" style="${existingUser?.role === 'admin' ? 'display:none' : ''}">
                            <label>Assigned Projects</label>
                            <div style="max-height: 150px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px; background: #fafafa;">
                                ${projectCheckboxes || '<p class="text-muted">No projects available</p>'}
                            </div>
                            <small class="text-muted">Operators can only access assigned projects</small>
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

        // Get selected projects for operators
        const projectIds = [];
        if (role === 'operator') {
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

    dumpSchema: async function(pushToGit = false) {
        const status = document.getElementById('schema-status');
        const result = document.getElementById('schema-result');
        const gitResult = document.getElementById('git-result');

        if (status) status.textContent = pushToGit ? 'Exporting and pushing...' : 'Exporting...';
        if (result) result.style.display = 'none';
        if (gitResult) gitResult.textContent = '';

        try {
            const url = pushToGit ? './db/dump_schema.php?push=1' : './db/dump_schema.php';
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'success') {
                if (status) status.textContent = `Done! ${data.tables} tables exported.`;
                if (result) result.style.display = 'block';

                if (data.git) {
                    if (data.git.pushed) {
                        if (gitResult) {
                            gitResult.innerHTML = `<strong style="color: green;">Pushed to branch: ${data.git.branch}</strong><br>
                                <small>You can now create a PR to merge this branch.</small>`;
                        }
                    } else {
                        if (gitResult) {
                            gitResult.innerHTML = `<strong style="color: red;">Git push failed</strong><br>
                                <small>${data.git.output || 'Unknown error'}</small>`;
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
                container.innerHTML = `<p class="error">${data.error}</p>`;
                return;
            }

            let html = '<table class="data-table compact">';
            html += `<tr><td><strong>Branch</strong></td><td>${data.branch}</td></tr>`;
            html += `<tr><td><strong>App Version</strong></td><td>${data.app_version || 'Unknown'}</td></tr>`;
            html += `<tr><td><strong>Commit</strong></td><td><code>${data.head_short}</code></td></tr>`;
            html += `<tr><td><strong>Behind Origin</strong></td><td>${data.behind_origin > 0 ? `<span style="color:orange">${data.behind_origin} commits</span>` : '<span style="color:green">Up to date</span>'}</td></tr>`;
            html += `<tr><td><strong>Ahead of Origin</strong></td><td>${data.ahead_origin > 0 ? `<span style="color:blue">${data.ahead_origin} commits</span>` : '0'}</td></tr>`;
            html += '</table>';

            // Recent commits
            if (data.last_commits && data.last_commits.length > 0) {
                html += '<h4>Recent Commits</h4><ul class="commit-list">';
                data.last_commits.forEach(c => {
                    html += `<li><code>${c}</code></li>`;
                });
                html += '</ul>';
            }

            // Untracked/modified files
            if ((data.untracked_files && data.untracked_files.length > 0) ||
                (data.modified_files && data.modified_files.length > 0)) {
                html += '<h4>Local Changes</h4>';
                if (data.untracked_files && data.untracked_files.length > 0) {
                    html += '<p><strong>Untracked:</strong> ' + data.untracked_files.join(', ') + '</p>';
                }
                if (data.modified_files && data.modified_files.length > 0) {
                    html += '<p><strong>Modified:</strong> ' + data.modified_files.join(', ') + '</p>';
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
                html += '<div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">';
                html += '<strong>Merge Branch:</strong> ';
                html += '<select id="merge-branch-select" style="margin: 0 0.5rem;">';
                data.remote_branches.forEach(b => {
                    html += `<option value="${b}">${b}</option>`;
                });
                html += '</select>';
                html += '<button class="btn btn-primary" onclick="AdminModule.mergeBranch()">Merge & Deploy</button>';
                html += '</div>';
            }

            html += '<div id="deploy-log" style="margin-top: 1rem;"></div>';

            container.innerHTML = html;
        } catch (err) {
            console.error('Failed to load deploy status:', err);
            container.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
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
            logContainer.innerHTML = `<p>Merging ${branch}...</p>`;
        }

        try {
            const response = await fetch('./api/heataq_api.php?action=merge_branch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch: branch })
            });
            const data = await response.json();

            if (data.error) {
                if (logContainer) logContainer.innerHTML = `<p class="error">${data.error}</p>`;
                return;
            }

            let html = '<div class="deploy-result">';
            html += `<p><strong>Result:</strong> ${data.success ? '<span style="color:green">Success</span>' : '<span style="color:red">Failed</span>'}</p>`;
            if (data.log) {
                html += '<pre class="deploy-log">';
                data.log.forEach(line => { html += line + '\n'; });
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
            if (logContainer) logContainer.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
        }
    },

    deployPull: async function() {
        const logContainer = document.getElementById('deploy-log');
        if (logContainer) {
            logContainer.innerHTML = '<p>Pulling updates...</p>';
        }

        try {
            const response = await fetch('./api/heataq_api.php?action=deploy_pull');
            const data = await response.json();

            if (data.error) {
                if (logContainer) logContainer.innerHTML = `<p class="error">${data.error}</p>`;
                return;
            }

            let html = '<div class="deploy-result">';
            html += `<p><strong>Result:</strong> ${data.success ? '<span style="color:green">Success</span>' : '<span style="color:red">Failed</span>'}</p>`;
            html += `<p><strong>Version:</strong> ${data.app_version}</p>`;
            html += `<p><strong>Commit:</strong> <code>${data.head}</code></p>`;
            html += '<h4>Log</h4><pre class="deploy-log">';
            data.log.forEach(line => {
                html += line + '\n';
            });
            html += '</pre>';
            html += '<p><strong>Refresh the page to see changes.</strong></p>';
            html += '</div>';

            if (logContainer) logContainer.innerHTML = html;
        } catch (err) {
            console.error('Deploy pull failed:', err);
            if (logContainer) logContainer.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
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
                listEl.innerHTML = `<p class="error">${data.error}</p>`;
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
                html += `<td><code>${m.filename}</code></td>`;

                // Show log link if log file exists
                if (m.has_log && m.log_file) {
                    const logColor = m.log_success ? 'green' : 'red';
                    const logIcon = m.log_success ? '✓' : '✗';
                    html += `<td id="${descId}"><a href="db/migrations/${m.log_file}" target="_blank" style="color: ${logColor};">${logIcon} View log</a></td>`;
                } else {
                    html += `<td id="${descId}">${m.description || '-'}</td>`;
                }

                // Show Done + Archive if log exists and was successful
                // Show Run + Archive if log exists but failed (can re-run or archive)
                // Show Run only if no log exists
                if (m.has_log) {
                    if (m.log_success) {
                        html += `<td id="${actionsId}">
                            <button class="btn btn-sm btn-success" disabled>✓ Done</button>
                            <button class="btn btn-sm btn-secondary" onclick="AdminModule.archiveMigration('${m.filename}')" style="margin-left: 5px;">Archive</button>
                        </td>`;
                    } else {
                        html += `<td id="${actionsId}">
                            <button class="btn btn-sm btn-primary" onclick="AdminModule.runMigration('${m.filename}', this)">Run</button>
                            <button class="btn btn-sm btn-secondary" onclick="AdminModule.archiveMigration('${m.filename}')" style="margin-left: 5px;">Archive</button>
                        </td>`;
                    }
                } else {
                    html += `<td id="${actionsId}"><button class="btn btn-sm btn-primary" onclick="AdminModule.runMigration('${m.filename}', this)">Run</button></td>`;
                }
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (listEl) listEl.innerHTML = html;

        } catch (err) {
            console.error('Check migrations failed:', err);
            if (listEl) listEl.innerHTML = `<p class="error">Failed to check: ${err.message}</p>`;
        }
    },

    runMigration: async function(filename, btn) {
        const resultEl = document.getElementById('migration-result');
        if (resultEl) resultEl.innerHTML = `<p>Running ${filename}...</p>`;

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
                if (resultEl) resultEl.innerHTML = `<p class="error">API error: ${response.status}</p>`;
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
                resultHtml += `<p style="color: green; font-weight: bold;">✓ SUCCESS: ${filename}</p>`;
                resultHtml += `<p>${data.statements} statements executed</p>`;
                if (data.tables_created && data.tables_created.length > 0) {
                    resultHtml += `<p>Tables: ${data.tables_created.join(', ')}</p>`;
                }

                // Update description to log link
                if (descEl) {
                    descEl.innerHTML = `<a href="db/migrations/${logFile}" target="_blank" style="color: green;">✓ View log</a>`;
                }

                // Update actions: green Done button + Archive button
                if (actionsEl) {
                    actionsEl.innerHTML = `
                        <button class="btn btn-sm" style="background-color: #28a745; color: white;" disabled>✓ Done</button>
                        <button class="btn btn-sm btn-secondary" onclick="AdminModule.archiveMigration('${filename}')" style="margin-left: 5px;">Archive</button>
                    `;
                }
            } else {
                resultHtml += `<p style="color: red; font-weight: bold;">✗ FAILED: ${filename}</p>`;
                resultHtml += `<p class="error">${data.error || 'Unknown error'}</p>`;

                // Update description to error log link
                if (descEl) {
                    descEl.innerHTML = `<a href="db/migrations/${logFile}" target="_blank" style="color: red;">✗ View error log</a>`;
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
                data.log.forEach(line => { resultHtml += line + '\n'; });
                resultHtml += '</pre></details>';
            }

            if (resultEl) resultEl.innerHTML = resultHtml;

        } catch (err) {
            console.error('Run migration failed:', err);
            if (resultEl) resultEl.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
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

        if (resultEl) resultEl.innerHTML = `<p>Archiving ${filename}...</p>`;

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
                    let html = `<p style="color: green; font-weight: bold;">✓ Archived ${filename}</p>`;
                    html += '<ul style="margin: 0.5rem 0; padding-left: 1.5rem; color: #666;">';
                    html += '<li>Moved to old_migrations/</li>';
                    html += '<li>Schema exported</li>';
                    html += `<li>Pushed to GitHub: ${data.pushed ? '✓' : '⚠ check manually'}</li>`;
                    html += '</ul>';
                    resultEl.innerHTML = html;
                }
            } else {
                if (resultEl) {
                    resultEl.innerHTML = `<p class="error">Archive failed: ${data.error || 'Unknown error'}</p>`;
                }
            }
        } catch (err) {
            console.error('Archive migration failed:', err);
            if (resultEl) resultEl.innerHTML = `<p class="error">Archive failed: ${err.message}</p>`;
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
