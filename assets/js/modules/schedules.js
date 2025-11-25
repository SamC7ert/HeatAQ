// Schedules module - Manages day and week schedules
// REVERTED to match original single-file version exactly

const schedules = {
    currentTemplate: 1,
    daySchedules: [],
    weekSchedules: [],
    selectedDaySchedule: null,
    selectedWeekSchedule: null,
    
    async init() {
        // Load templates list first, then load the selected template
        await this.loadTemplatesSelector();
        await this.loadTemplate();
    },
    
    async loadTemplate() {
        const selector = document.getElementById('ohc-selector');
        if (!selector) {
            // OHC selector not on current page, use default
            this.currentTemplate = 1;
            return;
        }
        this.currentTemplate = selector.value;

        // Update description
        const description = document.getElementById('ohc-description');
        if (description && config.templateDescriptions) {
            description.textContent = config.templateDescriptions[this.currentTemplate];
        }

        // Load all data for 3-column layout (Calendar | Week | Days)
        await Promise.all([
            this.loadDaySchedules(),
            this.loadWeekSchedules(),
            app.calendar ? app.calendar.loadCalendarData(this.currentTemplate) : Promise.resolve()
        ]);
    },
    
    async loadDaySchedules() {
        try {
            const data = await api.daySchedules.getAll();
            this.daySchedules = data.schedules || [];
            this.renderDayScheduleSelector();
        } catch (error) {
            console.error('Failed to load day schedules:', error);
        }
    },
    
    renderDayScheduleSelector() {
        const container = document.getElementById('day-schedules-container');
        if (!container) return;

        // Build options with summary hours
        let options = '<option value="">-- Select a schedule --</option>';
        this.daySchedules.forEach(schedule => {
            const hours = this.getDayScheduleHours(schedule);
            options += `<option value="${schedule.day_schedule_id}">${schedule.name} (${hours})</option>`;
        });

        let html = `
            <div class="form-group">
                <label class="form-label">Select Day Schedule:</label>
                <select id="day-schedule-selector" class="form-control" onchange="app.schedules.selectDaySchedule(this.value)">
                    ${options}
                </select>
            </div>

            <div id="day-schedule-editor" style="display: none;">
                <h4 id="day-schedule-title">Schedule Periods</h4>
                <div id="periods-container" style="overflow-x: auto;"></div>
                <div style="margin-top: 10px; display: flex; gap: 5px; flex-wrap: wrap;">
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.addPeriod()">+ Add Period</button>
                    <button class="btn btn-success btn-sm" onclick="app.schedules.saveDaySchedule()">Save</button>
                    <button class="btn btn-danger btn-sm" onclick="app.schedules.deleteDaySchedule()" style="margin-left: auto;">Delete Schedule</button>
                </div>
            </div>

            <hr style="margin: 15px 0;" />
            <div class="form-group">
                <label class="form-label text-small">Create New Day Schedule:</label>
                <div style="display: flex; gap: 5px;">
                    <input type="text" id="new-day-schedule-name" class="form-control form-control-sm" placeholder="Name" style="flex: 1;" />
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.createDaySchedule()">Create</button>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Re-select if we had one selected
        if (this.selectedDaySchedule) {
            const selector = document.getElementById('day-schedule-selector');
            if (selector) {
                selector.value = this.selectedDaySchedule.day_schedule_id;
                this.loadDayScheduleEditor();
            }
        }
    },

    getDayScheduleHours(schedule) {
        if (schedule.is_closed == 1) return 'Closed';

        let periods = [];
        if (schedule.periods) {
            if (typeof schedule.periods === 'string') {
                try {
                    let periodStrings = schedule.periods.split('},{');
                    periods = periodStrings.map((p, index) => {
                        if (index === 0 && !p.startsWith('{')) p = '{' + p;
                        if (index === periodStrings.length - 1 && !p.endsWith('}')) p = p + '}';
                        if (!p.startsWith('{')) p = '{' + p;
                        if (!p.endsWith('}')) p = p + '}';
                        return JSON.parse(p);
                    });
                } catch (e) { }
            } else if (Array.isArray(schedule.periods)) {
                periods = schedule.periods;
            }
        }

        if (periods.length === 0) return 'No periods';

        // Sum up hours
        let totalMinutes = 0;
        periods.forEach(p => {
            if (p.start_time && p.end_time) {
                const [sh, sm] = p.start_time.split(':').map(Number);
                const [eh, em] = p.end_time.split(':').map(Number);
                totalMinutes += (eh * 60 + em) - (sh * 60 + sm);
            }
        });

        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    },

    selectDaySchedule(scheduleId) {
        if (!scheduleId) {
            this.selectedDaySchedule = null;
            document.getElementById('day-schedule-editor').style.display = 'none';
            return;
        }

        const schedule = this.daySchedules.find(s => s.day_schedule_id == scheduleId);
        if (!schedule) return;

        this.selectedDaySchedule = schedule;
        this.loadDayScheduleEditor();
    },

    loadDayScheduleEditor() {
        if (!this.selectedDaySchedule) return;

        const schedule = this.selectedDaySchedule;
        const editor = document.getElementById('day-schedule-editor');
        const title = document.getElementById('day-schedule-title');

        if (title) title.textContent = schedule.name;
        if (editor) editor.style.display = 'block';

        // Parse periods
        let periods = [];
        if (schedule.periods) {
            if (typeof schedule.periods === 'string') {
                try {
                    let periodStrings = schedule.periods.split('},{');
                    periods = periodStrings.map((p, index) => {
                        if (index === 0 && !p.startsWith('{')) p = '{' + p;
                        if (index === periodStrings.length - 1 && !p.endsWith('}')) p = p + '}';
                        if (!p.startsWith('{')) p = '{' + p;
                        if (!p.endsWith('}')) p = p + '}';
                        return JSON.parse(p);
                    });
                } catch (e) {
                    console.error('Error parsing periods:', e);
                }
            } else if (Array.isArray(schedule.periods)) {
                periods = schedule.periods;
            }
        }

        this.currentPeriods = periods;
        this.renderPeriods();
    },

    async createDaySchedule() {
        const nameInput = document.getElementById('new-day-schedule-name');
        const name = nameInput?.value?.trim();

        if (!name) {
            api.utils.showError('Please enter a schedule name');
            return;
        }

        const periods = [{
            start_time: '10:00',
            end_time: '20:00',
            target_temp: 28.0,
            min_temp: 26.0,
            max_temp: 30.0,
            period_order: 1
        }];

        try {
            const result = await api.daySchedules.save({
                name: name,
                is_closed: 0,
                periods: periods
            });

            if (result.success) {
                api.utils.showSuccess('Created: ' + name);
                nameInput.value = '';
                await this.loadDaySchedules();
                // Also refresh week schedules (dropdown options) and calendar
                this.renderWeekScheduleSelector();
                if (app.calendar) {
                    app.calendar.daySchedules = this.daySchedules;
                    app.calendar.renderExceptionDays();
                }
                // Select the new schedule
                this.selectDaySchedule(result.day_schedule_id);
            }
        } catch (err) {
            api.utils.showError('Failed: ' + err.message);
        }
    },

    loadDaySchedule() {
        const selector = document.getElementById('day-schedule-selector');
        const scheduleId = parseInt(selector.value);

        if (!scheduleId) {
            document.getElementById('day-schedule-editor').style.display = 'none';
            return;
        }

        // Find the selected schedule
        const schedule = this.daySchedules.find(s => s.day_schedule_id === scheduleId);
        if (!schedule) return;

        this.selectedDaySchedule = schedule;

        // Show editor
        document.getElementById('day-schedule-editor').style.display = 'block';

        // Parse periods if they're a JSON string
        let periods = [];
        if (schedule.periods) {
            if (typeof schedule.periods === 'string') {
                // Handle GROUP_CONCAT JSON string
                try {
                    let periodStrings = schedule.periods.split('},{');
                    periods = periodStrings.map((p, index) => {
                        if (index === 0 && !p.startsWith('{')) p = '{' + p;
                        if (index === periodStrings.length - 1 && !p.endsWith('}')) p = p + '}';
                        if (!p.startsWith('{')) p = '{' + p;
                        if (!p.endsWith('}')) p = p + '}';
                        return JSON.parse(p);
                    });
                } catch (e) {
                    console.error('Error parsing periods:', e);
                }
            } else if (Array.isArray(schedule.periods)) {
                periods = schedule.periods;
            }
        }

        // Store current periods for editing
        this.currentPeriods = periods;

        // Render periods
        this.renderPeriods();
    },

    renderPeriods() {
        const container = document.getElementById('periods-container');
        if (!container) return;

        const schedule = this.selectedDaySchedule;
        const periods = this.currentPeriods || [];
        let html = '';

        if (schedule && schedule.is_closed == 1) {
            html = '<div class="alert alert-info">This is a closed day - pool is not operating</div>';
        } else if (periods.length > 0) {
            html = `
                <table class="table table-sm" id="periods-table" style="font-size: 0.85rem;">
                    <thead>
                        <tr>
                            <th style="width: 25px;">#</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Target °C</th>
                            <th style="width: 30px;"></th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            periods.forEach((period, index) => {
                const target = period.target_temp_c || period.target_temp || 28;
                // Format time as HH:MM (remove seconds if present)
                const startTime = (period.start_time || '10:00').substring(0, 5);
                const endTime = (period.end_time || '20:00').substring(0, 5);
                html += `
                    <tr data-index="${index}">
                        <td>${index + 1}</td>
                        <td><input type="time" class="form-control form-control-sm period-start" value="${startTime}" step="60" /></td>
                        <td><input type="time" class="form-control form-control-sm period-end" value="${endTime}" step="60" /></td>
                        <td><input type="number" class="form-control form-control-sm period-target" value="${target}" step="0.5" min="20" max="35" style="width: 70px;" /></td>
                        <td>
                            <button class="btn btn-danger btn-xs" onclick="app.schedules.removePeriod(${index})" title="Remove period" style="padding: 1px 6px;">×</button>
                        </td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
            `;
        } else {
            html = '<div class="alert alert-warning">No periods defined - click "+ Add Period" to add one</div>';
        }

        container.innerHTML = html;
    },
    
    async loadWeekSchedules() {
        try {
            const data = await api.weekSchedules.getAll();
            this.weekSchedules = data.schedules || [];
            this.renderWeekScheduleSelector();
        } catch (error) {
            console.error('Failed to load week schedules:', error);
        }
    },
    
    renderWeekScheduleSelector() {
        const container = document.getElementById('week-schedules-container');
        if (!container) return;

        // Build options with weekly hours summary
        let options = '<option value="">-- Select a schedule --</option>';
        this.weekSchedules.forEach(schedule => {
            const hours = this.getWeekScheduleHours(schedule);
            options += `<option value="${schedule.week_schedule_id}">${schedule.name} (${hours})</option>`;
        });

        let html = `
            <div class="form-group">
                <label class="form-label">Select Week Schedule:</label>
                <select id="week-schedule-selector" class="form-control" onchange="app.schedules.selectWeekSchedule(this.value)">
                    ${options}
                </select>
            </div>

            <div id="week-schedule-editor" style="display: none;">
                <table class="table table-sm" id="week-schedule-table">
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th>Day Schedule</th>
                        </tr>
                    </thead>
                    <tbody id="week-schedule-tbody">
                    </tbody>
                </table>
                <div style="margin-top: 10px; display: flex; gap: 5px;">
                    <button class="btn btn-success btn-sm" onclick="app.schedules.saveWeekSchedule()">Save</button>
                    <button class="btn btn-danger btn-sm" onclick="app.schedules.deleteWeekSchedule()" style="margin-left: auto;">Delete</button>
                </div>
            </div>

            <hr style="margin: 15px 0;" />
            <div class="form-group">
                <label class="form-label text-small">Create New Week Schedule:</label>
                <div style="display: flex; gap: 5px;">
                    <input type="text" id="new-week-schedule-name" class="form-control form-control-sm" placeholder="Name" style="flex: 1;" />
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.createWeekSchedule()">Create</button>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Re-select if we had one selected
        if (this.selectedWeekSchedule) {
            const selector = document.getElementById('week-schedule-selector');
            if (selector) {
                selector.value = this.selectedWeekSchedule.week_schedule_id;
                this.loadWeekScheduleEditor();
            }
        }
    },

    getWeekScheduleHours(schedule) {
        let totalMinutes = 0;
        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        dayKeys.forEach(dayKey => {
            const dayScheduleId = schedule[dayKey + '_schedule_id'];
            if (dayScheduleId) {
                const daySchedule = this.daySchedules.find(ds => ds.day_schedule_id == dayScheduleId);
                if (daySchedule) {
                    const hoursStr = this.getDayScheduleHours(daySchedule);
                    // Parse hours from string like "10h" or "10h 30m"
                    const match = hoursStr.match(/(\d+)h(?:\s*(\d+)m)?/);
                    if (match) {
                        totalMinutes += parseInt(match[1]) * 60 + (parseInt(match[2]) || 0);
                    }
                }
            }
        });

        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return mins > 0 ? `${hours}h ${mins}m/week` : `${hours}h/week`;
    },

    selectWeekSchedule(scheduleId) {
        if (!scheduleId) {
            this.selectedWeekSchedule = null;
            document.getElementById('week-schedule-editor').style.display = 'none';
            return;
        }

        const schedule = this.weekSchedules.find(s => s.week_schedule_id == scheduleId);
        if (!schedule) return;

        this.selectedWeekSchedule = schedule;
        this.loadWeekScheduleEditor();
    },

    loadWeekScheduleEditor() {
        if (!this.selectedWeekSchedule) return;

        const schedule = this.selectedWeekSchedule;
        const editor = document.getElementById('week-schedule-editor');
        if (editor) editor.style.display = 'block';

        // Populate table
        const tbody = document.getElementById('week-schedule-tbody');
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        let html = '';
        dayKeys.forEach((dayKey, index) => {
            const currentScheduleId = schedule[dayKey + '_schedule_id'];

            html += `
                <tr>
                    <td><strong>${days[index]}</strong></td>
                    <td>
                        <select class="form-control form-control-sm week-day-select" data-day="${dayKey}">
                            <option value="">-- Not set --</option>
                            ${this.daySchedules.map(ds =>
                                `<option value="${ds.day_schedule_id}" ${ds.day_schedule_id == currentScheduleId ? 'selected' : ''}>${ds.name}</option>`
                            ).join('')}
                        </select>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    },

    async createWeekSchedule() {
        const nameInput = document.getElementById('new-week-schedule-name');
        const name = nameInput?.value?.trim();

        if (!name) {
            api.utils.showError('Please enter a schedule name');
            return;
        }

        // Create with first day schedule as default for all days
        const firstDaySchedule = this.daySchedules[0]?.day_schedule_id || null;

        try {
            const result = await api.weekSchedules.save({
                name: name,
                monday_schedule_id: firstDaySchedule,
                tuesday_schedule_id: firstDaySchedule,
                wednesday_schedule_id: firstDaySchedule,
                thursday_schedule_id: firstDaySchedule,
                friday_schedule_id: firstDaySchedule,
                saturday_schedule_id: firstDaySchedule,
                sunday_schedule_id: firstDaySchedule
            });

            if (result.success) {
                api.utils.showSuccess('Created: ' + name);
                nameInput.value = '';
                await this.loadWeekSchedules();
                this.selectWeekSchedule(result.week_schedule_id);
            }
        } catch (err) {
            api.utils.showError('Failed: ' + err.message);
        }
    },

    async saveWeekSchedule() {
        if (!this.selectedWeekSchedule) {
            api.utils.showError('No week schedule selected');
            return;
        }

        // Collect day assignments from selects
        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const data = {
            week_schedule_id: this.selectedWeekSchedule.week_schedule_id,
            name: this.selectedWeekSchedule.name
        };

        dayKeys.forEach(dayKey => {
            const select = document.querySelector(`.week-day-select[data-day="${dayKey}"]`);
            if (select) {
                data[dayKey + '_schedule_id'] = select.value ? parseInt(select.value) : null;
            }
        });

        try {
            const result = await api.weekSchedules.save(data);
            if (result.success) {
                api.utils.showSuccess('Week schedule saved');
                const scheduleId = this.selectedWeekSchedule.week_schedule_id;
                // Reload to get fresh data
                await this.loadWeekSchedules();
                // Re-select the schedule
                this.selectWeekSchedule(scheduleId);
            }
        } catch (err) {
            api.utils.showError('Failed to save: ' + err.message);
        }
    },
    
    // Action methods
    addPeriod() {
        if (!this.selectedDaySchedule) {
            api.utils.showError('Please select a day schedule first');
            return;
        }

        // Initialize currentPeriods if needed
        if (!this.currentPeriods) {
            this.currentPeriods = [];
        }

        // Add a new period with default values
        const lastPeriod = this.currentPeriods[this.currentPeriods.length - 1];
        const newPeriod = {
            start_time: lastPeriod ? lastPeriod.end_time : '10:00',
            end_time: '20:00',
            target_temp: 28.0,
            min_temp: 26.0,
            max_temp: 30.0,
            period_order: this.currentPeriods.length + 1
        };

        this.currentPeriods.push(newPeriod);
        this.renderPeriods();
    },

    removePeriod(index) {
        if (!this.currentPeriods || index < 0 || index >= this.currentPeriods.length) {
            return;
        }

        this.currentPeriods.splice(index, 1);

        // Renumber remaining periods
        this.currentPeriods.forEach((p, i) => {
            p.period_order = i + 1;
        });

        this.renderPeriods();
    },

    collectPeriodsFromTable() {
        const table = document.getElementById('periods-table');
        if (!table) return [];

        const periods = [];
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach((row, index) => {
            const startInput = row.querySelector('.period-start');
            const endInput = row.querySelector('.period-end');
            const targetInput = row.querySelector('.period-target');

            if (startInput && endInput && targetInput) {
                const target = parseFloat(targetInput.value) || 28.0;
                periods.push({
                    start_time: startInput.value,
                    end_time: endInput.value,
                    target_temp: target,
                    min_temp: target - 2.0,  // Auto-calculate from target
                    max_temp: target + 2.0,
                    period_order: index + 1
                });
            }
        });

        return periods;
    },

    async saveDaySchedule() {
        if (!this.selectedDaySchedule) {
            api.utils.showError('No schedule selected');
            return;
        }

        // Collect periods from the table inputs
        const periods = this.collectPeriodsFromTable();

        // Validate periods
        for (const period of periods) {
            if (!period.start_time || !period.end_time) {
                api.utils.showError('All periods must have start and end times');
                return;
            }
            if (period.start_time >= period.end_time) {
                api.utils.showError('Start time must be before end time');
                return;
            }
            if (period.min_temp > period.target_temp || period.target_temp > period.max_temp) {
                api.utils.showError('Temperature order must be: Min ≤ Target ≤ Max');
                return;
            }
        }

        try {
            const result = await api.daySchedules.save({
                day_schedule_id: this.selectedDaySchedule.day_schedule_id,
                name: this.selectedDaySchedule.name,
                is_closed: this.selectedDaySchedule.is_closed || 0,
                periods: periods
            });

            if (result.success) {
                api.utils.showSuccess('Day schedule saved');
                const scheduleId = this.selectedDaySchedule.day_schedule_id;
                // Reload to get fresh data
                await this.loadDaySchedules();
                // Re-select the schedule
                this.selectDaySchedule(scheduleId);
            }
        } catch (err) {
            api.utils.showError('Failed to save: ' + err.message);
        }
    },

    async deleteDaySchedule() {
        if (!this.selectedDaySchedule) {
            api.utils.showError('No schedule selected');
            return;
        }

        const name = this.selectedDaySchedule.name;
        if (!confirm(`Delete day schedule "${name}"?\n\nThis cannot be undone.`)) {
            return;
        }

        try {
            await api.daySchedules.delete(this.selectedDaySchedule.day_schedule_id);
            api.utils.showSuccess('Day schedule deleted');
            this.selectedDaySchedule = null;
            await this.loadDaySchedules();
            // Also refresh week schedules and calendar
            this.renderWeekScheduleSelector();
            if (app.calendar) {
                app.calendar.daySchedules = this.daySchedules;
                app.calendar.renderExceptionDays();
            }
        } catch (err) {
            api.utils.showError('Failed to delete: ' + err.message);
        }
    },

    async deleteWeekSchedule() {
        if (!this.selectedWeekSchedule) {
            api.utils.showError('No week schedule selected');
            return;
        }

        const name = this.selectedWeekSchedule.name;
        if (!confirm(`Delete week schedule "${name}"?\n\nThis cannot be undone.`)) {
            return;
        }

        try {
            await api.weekSchedules.delete(this.selectedWeekSchedule.week_schedule_id);
            api.utils.showSuccess('Week schedule deleted');
            this.selectedWeekSchedule = null;
            await this.loadWeekSchedules();
            // Also refresh calendar
            if (app.calendar) {
                app.calendar.weekSchedules = this.weekSchedules;
                app.calendar.renderDateRanges();
            }
        } catch (err) {
            api.utils.showError('Failed to delete: ' + err.message);
        }
    },

    createTemplate() {
        console.log('Create new template');
        api.utils.showError('Template creation not yet implemented');
    },
    
    editTemplate() {
        console.log('Edit template:', this.currentTemplate);
        api.utils.showError('Template editing not yet implemented');
    },

    // OHC (Open Hours Calendar) methods
    async loadOHC() {
        // Reload template when OHC selection changes
        await this.loadTemplate();
    },

    async saveOHC() {
        console.log('Save OHC:', this.currentTemplate);
        api.utils.showSuccess('Schedule saved');
    },

    toggleNewOHCForm() {
        const form = document.getElementById('new-ohc-form');
        if (form) {
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
            if (form.style.display === 'block') {
                document.getElementById('new-ohc-name')?.focus();
            }
        }
    },

    async createOHC() {
        const nameInput = document.getElementById('new-ohc-name');
        const descInput = document.getElementById('new-ohc-description');

        const name = nameInput?.value?.trim();
        const description = descInput?.value?.trim() || '';

        if (!name) {
            api.utils.showError('Please enter a name');
            return;
        }

        try {
            const result = await api.templates.save({
                name: name,
                description: description
            });

            if (result.success) {
                api.utils.showSuccess('Template created: ' + name);
                // Clear and hide form
                nameInput.value = '';
                descInput.value = '';
                this.toggleNewOHCForm();
                // Reload templates selector
                await this.loadTemplatesSelector();
            }
        } catch (err) {
            api.utils.showError('Failed to create template: ' + err.message);
        }
    },

    // Legacy method for backwards compatibility
    newOHC() {
        this.toggleNewOHCForm();
    },

    async loadTemplatesSelector() {
        try {
            const data = await api.templates.getAll();
            const selector = document.getElementById('ohc-selector');
            if (selector && data.templates) {
                selector.innerHTML = data.templates.map(t =>
                    `<option value="${t.template_id}">${t.name}</option>`
                ).join('');
            }
            // Also update sim-ohc-select
            const simSelector = document.getElementById('sim-ohc-select');
            if (simSelector && data.templates) {
                simSelector.innerHTML = data.templates.map(t =>
                    `<option value="${t.template_id}">${t.name}</option>`
                ).join('');
            }
        } catch (error) {
            console.error('Failed to load templates:', error);
        }
    },

    // Legacy method aliases for backwards compatibility with HTML buttons
    addWeekSchedule() {
        // Focus the create input instead
        const input = document.getElementById('new-week-schedule-name');
        if (input) input.focus();
    },

    addDaySchedule() {
        // Focus the create input instead
        const input = document.getElementById('new-day-schedule-name');
        if (input) input.focus();
    }
};

// Export for use in other modules
window.schedules = schedules;
