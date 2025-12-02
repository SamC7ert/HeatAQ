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
