// Schedules module - Manages day and week schedules
// REVERTED to match original single-file version exactly

const schedules = {
    currentTemplate: null,
    daySchedules: [],
    weekSchedules: [],
    selectedDaySchedule: null,
    selectedWeekSchedule: null,
    
    // Called on a project switch: the selected schedules belong to the old
    // project (the editors used to re-open and save them back by id).
    resetProjectState() {
        this.selectedDaySchedule = null;
        this.selectedWeekSchedule = null;
        this.currentPeriods = null;
        this.currentTemplate = null;
    },

    async init() {
        // Load templates list first, then load the selected template
        await this.loadTemplatesSelector();
        await this.loadTemplate();
        // Enable OHC controls after loading completes
        this.enableOHCControls();
    },

    enableOHCControls() {
        // Enable the OHC selector and buttons after data is loaded
        const selector = document.getElementById('ohc-selector');
        const btnNew = document.getElementById('ohc-btn-new');
        const btnSave = document.getElementById('ohc-btn-save');
        const btnDelete = document.getElementById('ohc-btn-delete');

        if (selector) selector.disabled = false;
        if (btnNew) btnNew.disabled = false;
        if (btnSave) btnSave.disabled = false;
        if (btnDelete) btnDelete.disabled = false;
    },
    
    async loadTemplate() {
        const selector = document.getElementById('ohc-selector');
        if (!selector) {
            this.currentTemplate = null;
            return;
        }
        // No templates in this project -> no template (never another
        // project's "template 1")
        this.currentTemplate = selector.value || null;

        // Update description from stored templates
        const descriptionEl = document.getElementById('ohc-description');
        if (descriptionEl && this.templates) {
            const template = this.templates.find(t => t.template_id == this.currentTemplate);
            descriptionEl.textContent = template?.description || '';
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
            this.syncCalendarSchedules('day');
        } catch (error) {
            console.error('Failed to load day schedules:', error);
        }
    },

    // The calendar editor keeps its own copies of the schedule lists for its
    // dropdowns. Every reload here (create, save, delete) pushes the fresh list
    // across, so a new or renamed schedule appears in the calendar without a
    // page refresh. Only re-renders once the calendar has loaded its data.
    syncCalendarSchedules(kind) {
        if (!app.calendar) return;
        if (kind === 'week') {
            app.calendar.weekSchedules = this.weekSchedules;
            if (app.calendar.loaded) app.calendar.renderDateRanges();
        } else {
            app.calendar.daySchedules = this.daySchedules;
            if (app.calendar.loaded) app.calendar.renderExceptionDays();
        }
    },
    
    renderDayScheduleSelector() {
        const container = document.getElementById('day-schedules-container');
        if (!container) return;

        // Build options with summary hours
        let options = '<option value="">-- Select a schedule --</option>';
        this.daySchedules.forEach(schedule => {
            const hours = this.getDayScheduleHours(schedule);
            options += `<option value="${escapeHtml(schedule.day_schedule_id)}">${escapeHtml(schedule.name)} (${escapeHtml(hours)})</option>`;
        });

        let html = `
            <div class="form-group">
                <label class="form-label">Select Day Schedule:</label>
                <select id="day-schedule-selector" class="form-control" style="width: 100%; min-width: 200px;" onchange="app.schedules.selectDaySchedule(this.value)">
                    ${options}
                </select>
            </div>

            <div id="day-schedule-editor" style="display: none;">
                <h4 id="day-schedule-title">Schedule Periods</h4>
                <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; cursor: pointer; font-size: 0.85rem;">
                    <input type="checkbox" id="day-closed-toggle" onchange="app.schedules.setDayClosed(this.checked)" style="width: 16px; height: 16px;">
                    Closed day (no open hours)
                </label>
                <div id="periods-container" style="overflow-x: auto;"></div>
                <div style="margin-top: 10px; display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end;">
                    <button id="add-period-btn" class="btn btn-sm" onclick="app.schedules.addPeriod()" style="margin-right: auto; background: #90EE90; color: #000;">+ Add Period</button>
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.saveDaySchedule()">Save</button>
                    <button class="btn btn-danger btn-sm" onclick="app.schedules.deleteDaySchedule()">Delete</button>
                </div>
            </div>

            <hr style="margin: 15px 0;" />
            <div class="form-group">
                <label class="form-label text-small">Create New Day Schedule:</label>
                <div style="display: flex; gap: 5px;">
                    <input type="text" id="new-day-schedule-name" class="form-control form-control-sm" placeholder="Name" style="flex: 1;" />
                    <button class="btn btn-sm" style="background: #90EE90; color: #000;" onclick="app.schedules.createDaySchedule()">+ New</button>
                    <button class="btn btn-sm btn-secondary" onclick="app.schedules.createDaySchedule(true)" title="Create a day schedule with no open hours">+ Closed</button>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Re-select if we had one selected - and it is in this list
        if (this.selectedDaySchedule && !this.daySchedules.some(d => d.day_schedule_id == this.selectedDaySchedule.day_schedule_id)) {
            this.selectedDaySchedule = null;
            this.currentPeriods = null;
        }
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

        // No periods = closed in the simulator (PoolScheduler: is_open = !empty(periods))
        if (periods.length === 0) return 'Closed';

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
        this.initDayClosedState(schedule);
        this.renderPeriods();
    },

    async createDaySchedule(closed = false) {
        const nameInput = document.getElementById('new-day-schedule-name');
        const name = nameInput?.value?.trim();

        if (!name) {
            api.utils.showError('Please enter a schedule name');
            return;
        }

        // Closed day: no open hours. Open day: default 10:00-20:00 period.
        const periods = closed ? [] : [{
            start_time: '10:00',
            end_time: '20:00',
            target_temp: null,   // blank = use the configuration's default target
            min_temp: null,
            max_temp: null,
            period_order: 1
        }];

        try {
            const result = await api.daySchedules.save({
                name: name,
                is_closed: closed ? 1 : 0,
                periods: periods
            });

            if (result.success) {
                api.utils.showSuccess('Created: ' + name);
                nameInput.value = '';
                await this.loadDaySchedules();  // also syncs the calendar
                // Also refresh week schedules (dropdown options)
                this.renderWeekScheduleSelector();
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
        this.initDayClosedState(schedule);

        // Render periods
        this.renderPeriods();
    },

    // Closed state being edited (saved on Save). A schedule with no periods is
    // closed in the simulator too, so treat it as closed in the editor.
    initDayClosedState(schedule) {
        this.editClosed = schedule.is_closed == 1 || (this.currentPeriods || []).length === 0;
        const toggle = document.getElementById('day-closed-toggle');
        if (toggle) toggle.checked = this.editClosed;
    },

    // Toggle closed. Periods stay in memory, so unticking restores them; they
    // are only dropped when a closed schedule is saved.
    setDayClosed(closed) {
        this.editClosed = !!closed;
        if (!this.editClosed && (!this.currentPeriods || this.currentPeriods.length === 0)) {
            this.currentPeriods = [];
            this.addPeriod();  // re-opening starts with the default 10:00-20:00 period
            return;            // addPeriod renders
        }
        this.renderPeriods();
    },

    renderPeriods() {
        const container = document.getElementById('periods-container');
        if (!container) return;

        const periods = this.currentPeriods || [];
        let html = '';

        const addBtn = document.getElementById('add-period-btn');
        if (addBtn) addBtn.style.visibility = this.editClosed ? 'hidden' : 'visible';

        if (this.editClosed) {
            html = '<div class="alert alert-info">Closed day — pool not operating (no open hours)</div>';
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
                // Show the period's own target; blank = uses the configuration default
                const own = period.target_temp_c ?? period.target_temp;
                const target = (own === null || own === undefined || own === '') ? '' : own;
                // Format time as HH:MM (remove seconds if present)
                const startTime = (period.start_time || '10:00').substring(0, 5);
                const endTime = (period.end_time || '20:00').substring(0, 5);
                html += `
                    <tr data-index="${index}">
                        <td>${index + 1}</td>
                        <td><input type="text" class="form-control form-control-sm period-start" value="${escapeHtml(startTime)}" pattern="[0-2][0-9]:00" placeholder="HH:00" title="Whole hours, e.g. 06:00" style="width: 70px;" /></td>
                        <td><input type="text" class="form-control form-control-sm period-end" value="${escapeHtml(endTime)}" pattern="[0-2][0-9]:00" placeholder="HH:00" title="Whole hours, e.g. 06:00" style="width: 70px;" /></td>
                        <td><input type="number" class="form-control form-control-sm period-target" value="${escapeHtml(target)}" step="0.5" min="20" max="35" placeholder="default" title="Blank = use the configuration's default target" style="width: 70px;" /></td>
                        <td>
                            <button class="btn btn-danger btn-xs" onclick="app.schedules.removePeriod(${index})" title="Remove period" style="padding: 1px 6px;">×</button>
                        </td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
                <div class="text-muted" style="font-size: 0.75rem; margin-top: 2px;">Blank target = configuration default</div>
            `;
        } else {
            html = '<div class="alert alert-warning">No periods — click "+ Add Period", or tick "Closed day"</div>';
        }

        container.innerHTML = html;
    },
    
    async loadWeekSchedules() {
        try {
            const data = await api.weekSchedules.getAll();
            this.weekSchedules = data.schedules || [];
            this.renderWeekScheduleSelector();
            this.syncCalendarSchedules('week');
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
            options += `<option value="${escapeHtml(schedule.week_schedule_id)}">${escapeHtml(schedule.name)} (${escapeHtml(hours)})</option>`;
        });

        let html = `
            <div class="form-group">
                <label class="form-label">Select Week Schedule:</label>
                <select id="week-schedule-selector" class="form-control" style="width: 100%; min-width: 200px;" onchange="app.schedules.selectWeekSchedule(this.value)">
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
                <div style="margin-top: 10px; display: flex; gap: 5px; justify-content: flex-end;">
                    <button class="btn btn-primary btn-sm" onclick="app.schedules.saveWeekSchedule()">Save</button>
                    <button class="btn btn-danger btn-sm" onclick="app.schedules.deleteWeekSchedule()">Delete</button>
                </div>
            </div>

            <hr style="margin: 15px 0;" />
            <div class="form-group">
                <label class="form-label text-small">Create New Week Schedule:</label>
                <div style="display: flex; gap: 5px;">
                    <input type="text" id="new-week-schedule-name" class="form-control form-control-sm" placeholder="Name" style="flex: 1;" />
                    <button class="btn btn-sm" style="background: #90EE90; color: #000;" onclick="app.schedules.createWeekSchedule()">+ New</button>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Re-select if we had one selected, otherwise auto-select first
        const selector = document.getElementById('week-schedule-selector');
        if (this.selectedWeekSchedule && !this.weekSchedules.some(w => w.week_schedule_id == this.selectedWeekSchedule.week_schedule_id)) {
            this.selectedWeekSchedule = null;  // from another project / deleted
        }
        if (this.selectedWeekSchedule) {
            if (selector) {
                selector.value = this.selectedWeekSchedule.week_schedule_id;
                this.loadWeekScheduleEditor();
            }
        } else if (this.weekSchedules.length > 0 && selector) {
            // Auto-select the first week schedule to help user understand the logic
            selector.value = this.weekSchedules[0].week_schedule_id;
            this.selectWeekSchedule(this.weekSchedules[0].week_schedule_id);
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

        // Auto-select the earliest day schedule from this week (Monday first, then others)
        // This helps users understand which daily schedule is being used
        if (!this.selectedDaySchedule) {
            const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            for (const dayKey of dayKeys) {
                const dayScheduleId = schedule[dayKey + '_schedule_id'];
                if (dayScheduleId) {
                    const daySchedule = this.daySchedules.find(ds => ds.day_schedule_id == dayScheduleId);
                    if (daySchedule) {
                        // Select this day schedule in the daily schedules dropdown
                        const daySelector = document.getElementById('day-schedule-selector');
                        if (daySelector) {
                            daySelector.value = dayScheduleId;
                            this.selectDaySchedule(dayScheduleId);
                        }
                        break;
                    }
                }
            }
        }
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
                                `<option value="${escapeHtml(ds.day_schedule_id)}" ${ds.day_schedule_id == currentScheduleId ? 'selected' : ''}>${escapeHtml(ds.name)}</option>`
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
            target_temp: null,   // blank = use the configuration's default target
            min_temp: null,
            max_temp: null,
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
                // Whole hours only: the simulator works hour by hour
                const start = startInput.value.trim(), end = endInput.value.trim();
                if (!/^([01]\d|2[0-3]):00$/.test(start) || !/^(([01]\d|2[0-3]):00|24:00)$/.test(end)) {
                    throw new Error(`Period ${index + 1}: use whole hours (HH:00), e.g. 06:00-22:00`);
                }
                if (end !== '24:00' && end <= start) {
                    throw new Error(`Period ${index + 1}: the end must be after the start`);
                }
                // Blank target = use the configuration's default target
                const raw = targetInput.value.trim();
                const target = raw === '' ? null : parseFloat(raw);
                if (target !== null && (isNaN(target) || target < 20 || target > 35)) {
                    console.error(`Period ${index + 1}: Invalid target_temp value "${targetInput.value}"`);
                    throw new Error(`Period ${index + 1}: target must be 20-35°C, or blank to use the configuration default`);
                }
                periods.push({
                    start_time: startInput.value,
                    end_time: endInput.value,
                    target_temp: target,
                    min_temp: target === null ? null : target - 2.0,  // Auto-calculate from target
                    max_temp: target === null ? null : target + 2.0,
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

        // Closed day: no periods (the backend also skips them when is_closed).
        // An open day with no periods is closed in the simulator anyway, so
        // offer to save it as closed rather than storing an inconsistent pair.
        let closed = !!this.editClosed;
        let periods;
        try {
            periods = closed ? [] : this.collectPeriodsFromTable();
        } catch (err) {
            api.utils.showError(err.message);  // was thrown uncaught: no message shown
            return;
        }
        if (!closed && periods.length === 0) {
            if (!confirm('This schedule has no open periods. Save it as a closed day?')) return;
            closed = true;
        }

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
            if (period.target_temp !== null && (period.min_temp > period.target_temp || period.target_temp > period.max_temp)) {
                api.utils.showError('Temperature order must be: Min ≤ Target ≤ Max');
                return;
            }
        }

        try {
            const result = await api.daySchedules.save({
                day_schedule_id: this.selectedDaySchedule.day_schedule_id,
                name: this.selectedDaySchedule.name,
                is_closed: closed ? 1 : 0,
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
            await this.loadDaySchedules();  // also syncs the calendar
            // Also refresh week schedules (dropdown options)
            this.renderWeekScheduleSelector();
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
            await this.loadWeekSchedules();  // also syncs the calendar
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
        // OHC saves are done automatically through individual operations
        // This just confirms the current state
        api.utils.showSuccess('All changes saved');
    },

    async deleteOHC() {
        if (!this.currentTemplate) {
            api.utils.showError('No template selected');
            return;
        }

        if (!confirm('Delete this template and all its calendar rules? This cannot be undone.')) {
            return;
        }

        try {
            await api.templates.delete(this.currentTemplate);
            api.utils.showSuccess('Template deleted');
            // Reload templates; the first remaining one is selected (or none)
            this.currentTemplate = null;
            await this.loadTemplatesSelector();
            await this.loadTemplate();
        } catch (err) {
            api.utils.showError('Failed to delete: ' + err.message);
        }
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
                // Reload templates and switch to the new one (the selector
                // used to show one template while the calendar edited another)
                this.currentTemplate = result.template_id;
                await this.loadTemplatesSelector();
                await this.loadTemplate();
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
            // Store templates for description lookup
            this.templates = data.templates || [];

            const options = this.templates.length
                ? this.templates.map(t => `<option value="${escapeHtml(t.template_id)}">${escapeHtml(t.name)}</option>`).join('')
                : '<option value="">-- No schedule templates --</option>';
            const has = id => this.templates.some(t => String(t.template_id) === String(id));
            const selector = document.getElementById('ohc-selector');
            if (selector) {
                selector.innerHTML = options;
                // Keep the current template when it is still there, else the first
                if (has(this.currentTemplate)) selector.value = this.currentTemplate;
            }
            // Also update sim-ohc-select, keeping SimControl's choice
            const simSelector = document.getElementById('sim-ohc-select');
            if (simSelector) {
                const previous = simSelector.value;
                simSelector.innerHTML = options;
                if (has(previous)) simSelector.value = previous;
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
