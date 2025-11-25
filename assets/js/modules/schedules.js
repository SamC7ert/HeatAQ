// Schedules module - Manages day and week schedules
// REVERTED to match original single-file version exactly

const schedules = {
    currentTemplate: 1,
    daySchedules: [],
    weekSchedules: [],
    selectedDaySchedule: null,
    selectedWeekSchedule: null,
    
    async init() {
        // Load initial template
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
        
        // Create the original structure with dropdown selector
        let html = `
            <div class="card">
                <h3>Day Schedule Configuration</h3>
                <div class="form-group">
                    <label class="form-label">Select Day Schedule:</label>
                    <select id="day-schedule-selector" class="form-control" onchange="app.schedules.loadDaySchedule()">
                        <option value="">-- Select a schedule --</option>
        `;
        
        // Add options for each schedule
        this.daySchedules.forEach(schedule => {
            html += `<option value="${schedule.day_schedule_id}">${schedule.name}</option>`;
        });
        
        html += `
                    </select>
                </div>
                
                <div id="day-schedule-editor" style="display: none;">
                    <h4>Schedule Periods</h4>
                    <div id="periods-container"></div>
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.addPeriod()">+ Add Period</button>
                    <button class="btn btn-success btn-sm" onclick="app.schedules.saveDaySchedule()">Save Schedule</button>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
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
                <table class="table" id="periods-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Start</th>
                            <th>End</th>
                            <th>Target °C</th>
                            <th>Min °C</th>
                            <th>Max °C</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            periods.forEach((period, index) => {
                const target = period.target_temp_c || period.target_temp || 28;
                const min = period.min_temp || (target - 2);
                const max = period.max_temp || (target + 2);
                html += `
                    <tr data-index="${index}">
                        <td>${index + 1}</td>
                        <td><input type="time" class="form-control form-control-sm period-start" value="${period.start_time || '10:00'}" /></td>
                        <td><input type="time" class="form-control form-control-sm period-end" value="${period.end_time || '20:00'}" /></td>
                        <td><input type="number" class="form-control form-control-sm period-target" value="${target}" step="0.5" min="20" max="35" /></td>
                        <td><input type="number" class="form-control form-control-sm period-min" value="${min}" step="0.5" min="20" max="35" /></td>
                        <td><input type="number" class="form-control form-control-sm period-max" value="${max}" step="0.5" min="20" max="35" /></td>
                        <td>
                            <button class="btn btn-danger btn-sm" onclick="app.schedules.removePeriod(${index})" title="Remove">×</button>
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

        let html = `
            <div class="card">
                <h3>Week Schedule Configuration</h3>
                <div class="form-group">
                    <label class="form-label">Select Week Schedule:</label>
                    <select id="week-schedule-selector" class="form-control" onchange="app.schedules.loadWeekSchedule()">
                        <option value="">-- Select a schedule --</option>
        `;

        this.weekSchedules.forEach(schedule => {
            html += `<option value="${schedule.week_schedule_id}">${schedule.name}</option>`;
        });

        html += `
                    </select>
                </div>

                <div id="week-schedule-editor" style="display: none;">
                    <table class="table" id="week-schedule-table">
                        <thead>
                            <tr>
                                <th>Day</th>
                                <th>Day Schedule</th>
                            </tr>
                        </thead>
                        <tbody id="week-schedule-tbody">
                            <!-- Will be populated -->
                        </tbody>
                    </table>
                    <button class="btn btn-success btn-sm" onclick="app.schedules.saveWeekSchedule()">Save Week Schedule</button>
                </div>
            </div>
        `;

        container.innerHTML = html;
    },

    loadWeekSchedule() {
        const selector = document.getElementById('week-schedule-selector');
        const scheduleId = parseInt(selector.value);

        if (!scheduleId) {
            document.getElementById('week-schedule-editor').style.display = 'none';
            return;
        }

        // Find the selected schedule
        const schedule = this.weekSchedules.find(s => s.week_schedule_id === scheduleId);
        if (!schedule) return;

        this.selectedWeekSchedule = schedule;

        // Show editor
        document.getElementById('week-schedule-editor').style.display = 'block';

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
                // Reload to get fresh data
                await this.loadWeekSchedules();
                // Re-select the schedule
                const selector = document.getElementById('week-schedule-selector');
                if (selector) {
                    selector.value = this.selectedWeekSchedule.week_schedule_id;
                    this.loadWeekSchedule();
                }
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
            const minInput = row.querySelector('.period-min');
            const maxInput = row.querySelector('.period-max');

            if (startInput && endInput && targetInput) {
                periods.push({
                    start_time: startInput.value,
                    end_time: endInput.value,
                    target_temp: parseFloat(targetInput.value) || 28.0,
                    min_temp: parseFloat(minInput?.value) || 26.0,
                    max_temp: parseFloat(maxInput?.value) || 30.0,
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
                // Reload to get fresh data
                await this.loadDaySchedules();
                // Re-select the schedule
                const selector = document.getElementById('day-schedule-selector');
                if (selector) {
                    selector.value = this.selectedDaySchedule.day_schedule_id;
                    this.loadDaySchedule();
                }
            }
        } catch (err) {
            api.utils.showError('Failed to save: ' + err.message);
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

    newOHC() {
        const name = prompt('Enter name for new Open Hours Calendar:', 'Reference');
        if (!name) return;

        const description = prompt('Enter description (optional):', '');

        api.templates.save({
            name: name,
            description: description
        }).then(result => {
            if (result.success) {
                api.utils.showSuccess('Template created: ' + name);
                // Reload templates selector
                this.loadTemplatesSelector();
            }
        }).catch(err => {
            api.utils.showError('Failed to create template: ' + err.message);
        });
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

    addWeekSchedule() {
        const name = prompt('Enter name for new Week Schedule:', 'Normal Week');
        if (!name) return;

        // For now create with all days using the first day schedule
        const firstDaySchedule = this.daySchedules[0]?.day_schedule_id || null;

        api.weekSchedules.save({
            name: name,
            monday_schedule_id: firstDaySchedule,
            tuesday_schedule_id: firstDaySchedule,
            wednesday_schedule_id: firstDaySchedule,
            thursday_schedule_id: firstDaySchedule,
            friday_schedule_id: firstDaySchedule,
            saturday_schedule_id: firstDaySchedule,
            sunday_schedule_id: firstDaySchedule
        }).then(result => {
            if (result.success) {
                api.utils.showSuccess('Week schedule created: ' + name);
                this.loadWeekSchedules();
            }
        }).catch(err => {
            api.utils.showError('Failed to create week schedule: ' + err.message);
        });
    },

    addDaySchedule() {
        const name = prompt('Enter name for new Day Schedule:', 'Reference 10-20');
        if (!name) return;

        // Create with default 10:00-20:00 period (user can edit later)
        const periods = [{
            start_time: '10:00',
            end_time: '20:00',
            target_temp: 28.0,
            min_temp: 26.0,
            max_temp: 30.0,
            period_order: 1
        }];

        api.daySchedules.save({
            name: name,
            is_closed: 0,
            periods: periods
        }).then(result => {
            if (result.success) {
                api.utils.showSuccess('Day schedule created: ' + name + ' (default 10:00-20:00)');
                this.loadDaySchedules();
            }
        }).catch(err => {
            api.utils.showError('Failed to create day schedule: ' + err.message);
        });
    }
};

// Export for use in other modules
window.schedules = schedules;
