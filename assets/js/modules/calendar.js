// Calendar module - Manages calendar rules and holidays
// Updated for 3-column layout with full edit capabilities

const calendar = {
    calendarRules: [],
    exceptionDays: [],
    referenceDays: [],
    dateRanges: [],
    weekSchedules: [],
    daySchedules: [],
    currentTemplateId: 1,

    async loadCalendarData(templateId) {
        this.currentTemplateId = templateId;

        // Load week schedules and day schedules for dropdowns
        const wsData = await api.weekSchedules.getAll();
        this.weekSchedules = wsData.schedules || [];

        const dsData = await api.daySchedules.getAll();
        this.daySchedules = dsData.schedules || [];

        // Load calendar data
        await Promise.all([
            this.loadCalendarRules(templateId),
            this.loadReferenceDays()
        ]);
    },

    async loadCalendarRules(templateId) {
        try {
            const data = await api.calendar.getRules(templateId);
            this.dateRanges = data.rules || [];

            const exceptionsData = await api.calendar.getExceptionDays(templateId);
            this.exceptionDays = exceptionsData.exceptions || [];

            this.renderDateRanges();
            this.renderExceptionDays();
        } catch (error) {
            console.error('Failed to load calendar rules:', error);
        }
    },

    renderDateRanges() {
        const container = document.getElementById('date-ranges-container');
        if (!container) return;

        // Separate default (priority 0) from seasonal ranges
        const defaultRange = this.dateRanges.find(r => r.priority === 0 || r.priority === '0');
        const seasonalRanges = this.dateRanges.filter(r => r.priority > 0);

        let html = '';

        // Default/Year-round schedule
        html += `
            <div class="form-group" style="margin-bottom: 12px;">
                <label class="form-label text-small"><strong>Default (Year-Round):</strong></label>
                <select id="default-week-schedule" class="form-control form-control-sm" onchange="app.calendar.saveDefaultSchedule()">
                    <option value="">-- Select week schedule --</option>
                    ${this.weekSchedules.map(ws =>
                        `<option value="${ws.week_schedule_id}" ${defaultRange && defaultRange.week_schedule_id == ws.week_schedule_id ? 'selected' : ''}>${ws.name}</option>`
                    ).join('')}
                </select>
            </div>
        `;

        // Seasonal date ranges
        if (seasonalRanges.length > 0) {
            html += `
                <table class="data-table compact">
                    <thead>
                        <tr>
                            <th>Period</th>
                            <th>Week Schedule</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            seasonalRanges.forEach(range => {
                const startDate = this.formatDateShort(range.start_date);
                const endDate = this.formatDateShort(range.end_date);
                html += `
                    <tr data-range-id="${range.range_id || range.id}">
                        <td>${startDate} - ${endDate}</td>
                        <td>${range.week_schedule_name || 'Normal'}</td>
                        <td>
                            <button class="btn btn-danger btn-xs" onclick="app.calendar.deleteRange(${range.range_id || range.id})" title="Delete">×</button>
                        </td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                </table>
            `;
        } else {
            html += '<p class="text-muted text-small">No seasonal overrides</p>';
        }

        container.innerHTML = html;
    },

    renderExceptionDays() {
        const container = document.getElementById('exception-days-container');
        if (!container) return;

        if (this.exceptionDays.length === 0) {
            container.innerHTML = '<p class="text-muted text-small">No exception days configured</p>';
            return;
        }

        // Sort exception days
        const sortedExceptions = [...this.exceptionDays].sort((a, b) => {
            if (a.is_moving != b.is_moving) {
                return b.is_moving - a.is_moving;
            }
            if (a.is_moving) {
                return (a.easter_offset_days || 0) - (b.easter_offset_days || 0);
            }
            return ((a.fixed_month || 0) * 100 + (a.fixed_day || 0)) -
                   ((b.fixed_month || 0) * 100 + (b.fixed_day || 0));
        });

        let html = `
            <table class="data-table compact">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Date</th>
                        <th>Schedule</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
        `;

        sortedExceptions.forEach(exception => {
            let dateRef;
            if (exception.is_moving) {
                const offset = exception.easter_offset_days || 0;
                dateRef = offset === 0 ? 'Easter' :
                          offset > 0 ? `Easter+${offset}` : `Easter${offset}`;
            } else {
                dateRef = `${exception.fixed_day}/${exception.fixed_month}`;
            }

            const exceptionId = exception.exception_id || exception.id;
            const currentDayScheduleId = exception.day_schedule_id;

            html += `
                <tr data-exception-id="${exceptionId}">
                    <td>${exception.name}</td>
                    <td>${dateRef}</td>
                    <td>
                        <select class="form-control form-control-sm exception-day-select"
                                data-exception-id="${exceptionId}"
                                onchange="app.calendar.updateExceptionSchedule(${exceptionId}, this.value)">
                            ${this.daySchedules.map(ds =>
                                `<option value="${ds.day_schedule_id}" ${ds.day_schedule_id == currentDayScheduleId ? 'selected' : ''}>${ds.name}</option>`
                            ).join('')}
                        </select>
                    </td>
                    <td>
                        <button class="btn btn-danger btn-xs" onclick="app.calendar.deleteException(${exceptionId})" title="Delete">×</button>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    async updateExceptionSchedule(exceptionId, dayScheduleId) {
        // Find the exception to update
        const exception = this.exceptionDays.find(e => (e.exception_id || e.id) == exceptionId);
        if (!exception) return;

        try {
            await api.calendar.saveExceptionDay({
                exception_id: exceptionId,
                template_id: this.currentTemplateId,
                name: exception.name,
                day_schedule_id: dayScheduleId || null,
                is_moving: exception.is_moving,
                easter_offset_days: exception.easter_offset_days,
                fixed_month: exception.fixed_month,
                fixed_day: exception.fixed_day
            });

            api.utils.showSuccess('Exception updated');
        } catch (err) {
            api.utils.showError('Failed: ' + err.message);
            // Reload to reset
            await this.loadCalendarRules(this.currentTemplateId);
        }
    },

    async loadReferenceDays() {
        try {
            const data = await api.calendar.getReferenceDays();
            this.referenceDays = data.reference_days || [];
        } catch (error) {
            console.error('Failed to load reference days:', error);
        }
    },

    formatDateShort(dateStr) {
        if (!dateStr) return '--';
        // Use string parsing to avoid timezone issues
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = parseInt(parts[2], 10);
        const month = months[parseInt(parts[1], 10) - 1];
        return `${day} ${month}`;
    },

    // Save default (year-round) schedule
    async saveDefaultSchedule() {
        const select = document.getElementById('default-week-schedule');
        const weekScheduleId = select.value;

        if (!weekScheduleId) {
            return;
        }

        // Find existing default range (priority 0)
        const defaultRange = this.dateRanges.find(r => r.priority === 0 || r.priority === '0');

        try {
            await api.calendar.saveDateRange({
                range_id: defaultRange?.range_id || null,
                template_id: this.currentTemplateId,
                week_schedule_id: parseInt(weekScheduleId),
                start_date: null,
                end_date: null,
                priority: 0
            });

            api.utils.showSuccess('Default schedule saved');
            await this.loadCalendarRules(this.currentTemplateId);
        } catch (err) {
            api.utils.showError('Failed to save: ' + err.message);
        }
    },

    // Add a seasonal date range
    addDateRange() {
        const startDate = prompt('Start date (YYYY-MM-DD):', '2024-06-01');
        if (!startDate) return;

        const endDate = prompt('End date (YYYY-MM-DD):', '2024-08-31');
        if (!endDate) return;

        // Show week schedule options
        const options = this.weekSchedules.map((ws, i) => `${i + 1}. ${ws.name}`).join('\n');
        const choice = prompt(`Select week schedule:\n${options}`, '1');
        if (!choice) return;

        const wsIndex = parseInt(choice) - 1;
        if (wsIndex < 0 || wsIndex >= this.weekSchedules.length) {
            api.utils.showError('Invalid selection');
            return;
        }

        const weekScheduleId = this.weekSchedules[wsIndex].week_schedule_id;

        api.calendar.saveDateRange({
            template_id: this.currentTemplateId,
            week_schedule_id: weekScheduleId,
            start_date: startDate,
            end_date: endDate,
            priority: 1
        }).then(result => {
            if (result.success) {
                api.utils.showSuccess('Date range added');
                this.loadCalendarRules(this.currentTemplateId);
            }
        }).catch(err => {
            api.utils.showError('Failed to add: ' + err.message);
        });
    },

    async deleteRange(rangeId) {
        if (!confirm('Delete this date range?')) return;

        try {
            await api.calendar.deleteDateRange(rangeId);
            api.utils.showSuccess('Date range deleted');
            await this.loadCalendarRules(this.currentTemplateId);
        } catch (err) {
            api.utils.showError('Failed to delete: ' + err.message);
        }
    },

    addExceptionDay() {
        // Simple prompts for now
        const name = prompt('Exception day name:', 'Christmas Day');
        if (!name) return;

        const isMoving = confirm('Is this a moving holiday (relative to Easter)?\n\nOK = Easter-relative\nCancel = Fixed date');

        let easterOffset = null;
        let fixedMonth = null;
        let fixedDay = null;

        if (isMoving) {
            const offsetStr = prompt('Days offset from Easter Sunday:\n0 = Easter\n-2 = Good Friday\n1 = Easter Monday', '0');
            if (offsetStr === null) return;
            easterOffset = parseInt(offsetStr);
            if (isNaN(easterOffset)) {
                api.utils.showError('Invalid offset');
                return;
            }
        } else {
            const monthStr = prompt('Month (1-12):', '12');
            if (!monthStr) return;
            const dayStr = prompt('Day (1-31):', '25');
            if (!dayStr) return;
            fixedMonth = parseInt(monthStr);
            fixedDay = parseInt(dayStr);
            if (!fixedMonth || !fixedDay || fixedMonth < 1 || fixedMonth > 12 || fixedDay < 1 || fixedDay > 31) {
                api.utils.showError('Invalid date');
                return;
            }
        }

        // Default to Closed day schedule
        const closedSchedule = this.daySchedules.find(ds => ds.name.toLowerCase().includes('closed'));
        const dayScheduleId = closedSchedule?.day_schedule_id || this.daySchedules[0]?.day_schedule_id;

        api.calendar.saveExceptionDay({
            template_id: this.currentTemplateId,
            name: name,
            day_schedule_id: dayScheduleId,
            is_moving: isMoving ? 1 : 0,
            easter_offset_days: easterOffset,
            fixed_month: fixedMonth,
            fixed_day: fixedDay
        }).then(result => {
            if (result.success) {
                api.utils.showSuccess('Exception added');
                this.loadCalendarRules(this.currentTemplateId);
            }
        }).catch(err => {
            api.utils.showError('Failed: ' + err.message);
        });
    },

    async deleteException(exceptionId) {
        if (!confirm('Delete this exception day?')) return;

        try {
            await api.calendar.deleteExceptionDay(exceptionId);
            api.utils.showSuccess('Exception deleted');
            await this.loadCalendarRules(this.currentTemplateId);
        } catch (err) {
            api.utils.showError('Failed: ' + err.message);
        }
    }
};

// Export for use in other modules
window.calendar = calendar;
