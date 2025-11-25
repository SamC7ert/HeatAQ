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
            container.innerHTML = '<p class="text-muted">No holiday definitions</p>';
            return;
        }

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Name</th><th>Type</th><th>Date/Offset</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        this.holidayDefinitions.forEach(def => {
            const dateInfo = def.is_moving
                ? `Easter ${def.easter_offset_days >= 0 ? '+' : ''}${def.easter_offset_days} days`
                : `${def.fixed_day}/${def.fixed_month}`;

            html += `<tr>
                <td>${def.name}</td>
                <td>${def.is_moving ? 'Moving' : 'Fixed'}</td>
                <td>${dateInfo}</td>
                <td>
                    <button class="btn btn-xs btn-secondary" onclick="app.admin.editHolidayDefinition(${def.id})">Edit</button>
                    <button class="btn btn-xs btn-danger" onclick="app.admin.deleteHolidayDefinition(${def.id})">Delete</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
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
        if (!confirm('Delete this holiday definition?')) return;

        try {
            const response = await fetch(`./api/heataq_api.php?action=delete_holiday_definition&id=${id}`);
            const result = await response.json();

            if (result.success) {
                this.loadHolidayDefinitions();
            } else {
                alert('Failed to delete: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Failed to delete holiday definition:', err);
            alert('Failed to delete holiday definition');
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

        // Show last 10 years of Easter dates
        const recentYears = this.referenceDays.slice(-10);

        let html = '<table class="data-table compact"><thead><tr>' +
            '<th>Year</th><th>Easter Date</th>' +
            '</tr></thead><tbody>';

        recentYears.forEach(ref => {
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

            if (stationsData.stations) {
                this.weatherStations = stationsData.stations;
                this.renderWeatherStations();
                this.populateStationDropdown();
            }

            // Load data for selected station (or all)
            await this.loadWeatherData();
        } catch (err) {
            console.error('Failed to load weather stations:', err);
            document.getElementById('weather-stations-list').innerHTML =
                '<p class="error">Failed to load weather stations</p>';
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
                <th>Solar kWh/m²</th>
            </tr></thead><tbody>`;

        data.forEach(row => {
            html += `<tr>
                <td>${row.year}</td>
                <td>${row.avg_temp}</td>
                <td>${row.min_temp}</td>
                <td>${row.max_temp}</td>
                <td>${row.avg_wind}</td>
                <td>${row.avg_humidity}</td>
                <td>${row.total_solar_kwh_m2?.toLocaleString() || '-'}</td>
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
                <th>Solar W/m²</th>
            </tr></thead><tbody>`;

        data.forEach(row => {
            html += `<tr>
                <td>${row.month_name}</td>
                <td>${row.avg_temp}</td>
                <td>${row.min_temp}</td>
                <td>${row.max_temp}</td>
                <td>${row.avg_wind}</td>
                <td>${row.avg_humidity}</td>
                <td>${row.avg_solar_w_m2}</td>
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
    }
};

// Export for use in app
window.AdminModule = AdminModule;
