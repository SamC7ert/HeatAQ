/**
 * HeatAQ Calendar Module
 * Calendar rules, date ranges, and exceptions
 */

const Calendar = {
    dateRanges: [],
    exceptions: [],

    /**
     * Load calendar data
     */
    async loadCalendarData() {
        await Promise.all([
            this.loadDateRanges(),
            this.loadExceptions()
        ]);
    },

    /**
     * Load date ranges
     */
    async loadDateRanges() {
        const container = document.getElementById('date-ranges-list');
        UI.showLoading(container);

        try {
            const response = await API.get('', { action: 'get_calendar_date_ranges' });

            if (response.success) {
                this.dateRanges = response.data;
                this.renderDateRanges(response.data);
            }

        } catch (error) {
            UI.showError(container, 'Failed to load date ranges');
        }
    },

    /**
     * Load exception days
     */
    async loadExceptions() {
        const container = document.getElementById('exceptions-list');
        UI.showLoading(container);

        try {
            const response = await API.get('', { action: 'get_calendar_exceptions' });

            if (response.success) {
                this.exceptions = response.data;
                this.renderExceptions(response.data);
            }

        } catch (error) {
            UI.showError(container, 'Failed to load exceptions');
        }
    },

    /**
     * Render date ranges
     */
    renderDateRanges(ranges) {
        const container = document.getElementById('date-ranges-list');

        if (ranges.length === 0) {
            container.innerHTML = '<p class="empty">No date ranges defined.</p>';
            return;
        }

        const html = ranges.map(range => `
            <div class="calendar-item" data-id="${range.range_id}">
                <div class="calendar-header">
                    <span class="date-range">${range.start_date} to ${range.end_date}</span>
                    <span class="priority">Priority: ${range.priority}</span>
                </div>
                <div class="calendar-body">
                    <p><strong>Week Schedule:</strong> ${range.week_schedule_name}</p>
                    <p><strong>Status:</strong> ${range.is_active ? 'Active' : 'Inactive'}</p>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    },

    /**
     * Render exceptions
     */
    renderExceptions(exceptions) {
        const container = document.getElementById('exceptions-list');

        if (exceptions.length === 0) {
            container.innerHTML = '<p class="empty">No exception days defined.</p>';
            return;
        }

        const html = exceptions.map(exc => `
            <div class="calendar-item" data-id="${exc.exception_id}">
                <div class="calendar-header">
                    <span class="date">${exc.exception_date || exc.holiday_name}</span>
                    <span class="priority">Priority: ${exc.priority}</span>
                </div>
                <div class="calendar-body">
                    <p><strong>Day Schedule:</strong> ${exc.day_schedule_name}</p>
                    <p><strong>Type:</strong> ${exc.exception_type}</p>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }
};
