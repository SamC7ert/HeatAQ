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
            const isMoving = def.is_moving == 1;
            const dateValue = isMoving
                ? (def.easter_offset_days || 0)
                : `${String(def.fixed_month || 1).padStart(2,'0')}-${String(def.fixed_day || 1).padStart(2,'0')}`;

            html += `<tr data-id="${def.id}">
                <td><input type="text" class="inline-edit" value="${def.name || ''}"
                    onchange="app.admin.updateHolidayField('${def.id}', 'name', this.value)"></td>
                <td><select class="inline-edit" onchange="app.admin.updateHolidayType('${def.id}', this.value)">
                    <option value="fixed" ${!isMoving ? 'selected' : ''}>Fixed</option>
                    <option value="moving" ${isMoving ? 'selected' : ''}>Moving</option>
                </select></td>
                <td>${isMoving
                    ? `<input type="number" class="inline-edit" style="width:60px" value="${def.easter_offset_days || 0}"
                        onchange="app.admin.updateHolidayField('${def.id}', 'easter_offset_days', this.value)"> days from Easter`
                    : `<input type="date" class="inline-edit" value="2000-${dateValue}"
                        onchange="app.admin.updateHolidayDate('${def.id}', this.value)">`
                }</td>
                <td><button class="btn btn-xs btn-danger" onclick="app.admin.deleteHolidayDefinition('${def.id}')" title="Delete">×</button></td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    updateHolidayField: async function(id, field, value) {
        const def = this.holidayDefinitions.find(d => d.id === id);
        if (!def) return;
        def[field] = value;
        await this.saveHolidayInline(def);
    },

    updateHolidayType: async function(id, type) {
        const def = this.holidayDefinitions.find(d => d.id === id);
        if (!def) return;
        def.is_moving = type === 'moving' ? 1 : 0;
        await this.saveHolidayInline(def);
        this.renderHolidayDefinitions(); // Re-render to show correct date field
    },

    updateHolidayDate: async function(id, dateValue) {
        const def = this.holidayDefinitions.find(d => d.id === id);
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
                    is_moving: def.is_moving,
                    fixed_month: def.fixed_month,
                    fixed_day: def.fixed_day,
                    easter_offset_days: def.easter_offset_days
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
        const def = this.holidayDefinitions.find(d => d.id === id);
        if (def) {
            this.showHolidayForm(def);
        }
    },

    showHolidayForm: function(existingDef) {
        const isEdit = !!existingDef;
        const title = isEdit ? 'Edit Holiday' : 'Add Holiday';

        const html = `
            <div class="modal-overlay" onclick="app.admin.closeHolidayForm()">
                <div class="modal-content" onclick="event.stopPropagation()">
                    <h3>${title}</h3>
                    <form id="holiday-form">
                        <input type="hidden" id="holiday-id" value="${existingDef?.id || ''}">

                        <div class="form-group">
                            <label>Name (Norwegian)</label>
                            <input type="text" id="holiday-name" class="form-control" required
                                value="${existingDef?.name || ''}" placeholder="e.g., Langfredag">
                        </div>

                        <div class="form-group">
                            <label>Type</label>
                            <select id="holiday-type" class="form-control" onchange="app.admin.toggleHolidayType()">
                                <option value="fixed" ${!existingDef?.is_moving ? 'selected' : ''}>Fixed Date</option>
                                <option value="moving" ${existingDef?.is_moving ? 'selected' : ''}>Relative to Easter</option>
                            </select>
                        </div>

                        <div id="fixed-date-fields" style="${existingDef?.is_moving ? 'display:none' : ''}">
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

                        <div id="moving-date-fields" style="${existingDef?.is_moving ? '' : 'display:none'}">
                            <div class="form-group">
                                <label>Days from Easter (negative = before)</label>
                                <input type="number" id="holiday-offset" class="form-control" min="-60" max="60"
                                    value="${existingDef?.easter_offset_days || 0}">
                                <small class="text-muted">E.g., -2 = Good Friday, +1 = Easter Monday</small>
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
        document.getElementById('moving-date-fields').style.display = type === 'moving' ? '' : 'none';
    },

    closeHolidayForm: function() {
        const modal = document.getElementById('holiday-modal');
        if (modal) modal.remove();
    },

    saveHolidayDefinition: async function() {
        const id = document.getElementById('holiday-id').value;
        const name = document.getElementById('holiday-name').value;
        const type = document.getElementById('holiday-type').value;
        const isMoving = type === 'moving';

        const data = {
            action: 'save_holiday_definition',
            id: id || null,
            name: name,
            is_moving: isMoving ? 1 : 0,
            fixed_day: isMoving ? null : parseInt(document.getElementById('holiday-day').value),
            fixed_month: isMoving ? null : parseInt(document.getElementById('holiday-month').value),
            easter_offset_days: isMoving ? parseInt(document.getElementById('holiday-offset').value) : null
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
            console.error('Failed to save holiday definition:', err);
            alert('Failed to save holiday definition');
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

                if (stationsData.summary) {
                    this.renderWeatherSummary(stationsData.summary);
                }
            }

            // Load yearly and monthly data
            await this.loadWeatherData();
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

        select.innerHTML = '<option value="">-- All Stations --</option>' +
            this.weatherStations.map(s =>
                `<option value="${s.station_id}">${s.name}</option>`
            ).join('');
    },

    onStationChange: async function() {
        const select = document.getElementById('weather-station-select');
        this.selectedStationId = select ? select.value : '';
        await this.loadWeatherData();
    },

    loadWeatherData: async function() {
        const stationParam = this.selectedStationId ? `&station_id=${this.selectedStationId}` : '';

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
            '<th>Name</th><th>Station ID</th><th>Location</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        this.weatherStations.forEach(station => {
            html += `<tr>
                <td>${station.name}</td>
                <td>${station.station_id}</td>
                <td>${station.latitude || '-'}, ${station.longitude || '-'}</td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="app.admin.editWeatherStation('${station.station_id}')">Edit</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
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
        alert('Weather station import not yet implemented.\nWeather data is typically imported via batch process.');
    },

    editWeatherStation: function(stationId) {
        alert('Weather station editing not yet implemented.');
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
            document.getElementById('users-list').innerHTML =
                '<p class="error">Failed to load users</p>';
        }
    },

    renderUsers: function() {
        const container = document.getElementById('users-list');
        if (!container) return;

        if (this.users.length === 0) {
            container.innerHTML = '<p class="text-muted">No users</p>';
            return;
        }

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Email</th><th>Name</th><th>Role</th><th>Projects</th><th>Active</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        this.users.forEach(user => {
            const roleLabel = user.role === 'admin' ? 'Admin' : 'Operator';
            const projectNames = user.project_names || '-';
            html += `<tr>
                <td>${user.email}</td>
                <td>${user.name || '-'}</td>
                <td>${roleLabel}</td>
                <td>${projectNames}</td>
                <td>${user.is_active ? 'Yes' : 'No'}</td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="app.admin.editUser(${user.user_id})">Edit</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
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

        // Build project checkboxes
        const projectCheckboxes = this.projects.map(p => `
            <label style="display: block; margin: 5px 0;">
                <input type="checkbox" name="user-projects" value="${p.project_id}"
                    ${userProjectIds.includes(p.project_id) ? 'checked' : ''}>
                ${p.project_name}
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

                        <div class="form-group">
                            <label>Role</label>
                            <select id="user-role" class="form-control" onchange="app.admin.toggleProjectsField()">
                                <option value="operator" ${existingUser?.role !== 'admin' ? 'selected' : ''}>Operator</option>
                                <option value="admin" ${existingUser?.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>

                        <div class="form-group" id="projects-field" style="${existingUser?.role === 'admin' ? 'display:none' : ''}">
                            <label>Assigned Projects</label>
                            <div style="max-height: 150px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                                ${projectCheckboxes || '<p class="text-muted">No projects available</p>'}
                            </div>
                            <small>Operators can only access assigned projects</small>
                        </div>

                        ${!isEdit ? `
                        <div class="form-group">
                            <label>Password</label>
                            <input type="password" id="user-password" class="form-control" required>
                        </div>
                        ` : ''}

                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="user-active" ${existingUser?.is_active !== false ? 'checked' : ''}>
                                Active
                            </label>
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
            is_active: document.getElementById('user-active').checked ? 1 : 0
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
    }
};

// Export for use in app
window.AdminModule = AdminModule;
