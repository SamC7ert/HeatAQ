// Calendar module - Manages calendar rules and holidays
// Updated for 3-column layout

const calendar = {
    calendarRules: [],
    exceptionDays: [],
    referenceDays: [],
    dateRanges: [],
    weekSchedules: [],

    async loadCalendarData(templateId) {
        // Load all calendar data in parallel
        await Promise.all([
            this.loadCalendarRules(templateId),
            this.loadReferenceDays()
        ]);
    },

    async loadCalendarRules(templateId) {
        try {
            const data = await api.calendar.getRules(templateId);
            this.dateRanges = data.rules || [];

            // Also load exception days
            const exceptionsData = await api.calendar.getExceptionDays(templateId);
            this.exceptionDays = exceptionsData.exceptions || [];

            // Render to 3-column containers
            this.renderDateRanges();
            this.renderExceptionDays();
        } catch (error) {
            console.error('Failed to load calendar rules:', error);
        }
    },

    renderDateRanges() {
        const container = document.getElementById('date-ranges-container');
        if (!container) return;

        if (this.dateRanges.length === 0) {
            container.innerHTML = '<p class="text-muted text-small">No date ranges defined</p>';
            return;
        }

        let html = `
            <table class="data-table compact">
                <thead>
                    <tr>
                        <th>Period</th>
                        <th>Week Schedule</th>
                    </tr>
                </thead>
                <tbody>
        `;

        this.dateRanges.forEach(range => {
            if (range.priority > 0) {
                const startDate = this.formatDateShort(range.start_date);
                const endDate = this.formatDateShort(range.end_date);
                html += `
                    <tr data-range-id="${range.range_id || range.id}">
                        <td>${startDate} - ${endDate}</td>
                        <td>${range.week_schedule_name || range.name || 'Normal'}</td>
                    </tr>
                `;
            }
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    renderExceptionDays() {
        const container = document.getElementById('exception-days-container');
        if (!container) return;

        if (this.exceptionDays.length === 0) {
            container.innerHTML = '<p class="text-muted text-small">No exception days defined</p>';
            return;
        }

        // Sort exception days - moving first, then fixed
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

            html += `
                <tr data-exception-id="${exception.exception_id || exception.id}">
                    <td>${exception.name}</td>
                    <td>${dateRef}</td>
                    <td>${exception.day_schedule_name || 'Closed'}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
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
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    },

    // Action methods
    addDateRange() {
        console.log('Add date range');
        api.utils.showError('Add date range functionality not yet implemented');
    },

    deleteRange(rangeId) {
        console.log('Delete range:', rangeId);
        api.utils.showError('Delete functionality not yet implemented');
    },

    addExceptionDay() {
        console.log('Add exception day');
        api.utils.showError('Add exception day functionality not yet implemented');
    },

    deleteException(exceptionId) {
        console.log('Delete exception:', exceptionId);
        api.utils.showError('Delete functionality not yet implemented');
    }
};

// Export for use in other modules
window.calendar = calendar;
