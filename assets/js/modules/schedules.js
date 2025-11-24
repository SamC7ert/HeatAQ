/**
 * HeatAQ Schedule Management Module
 * Day and week schedule CRUD operations
 */

const Schedules = {
    daySchedules: [],
    weekSchedules: [],

    /**
     * Load day schedules from API
     */
    async loadDaySchedules() {
        const container = document.getElementById('day-schedules-list');
        UI.showLoading(container);

        try {
            const response = await API.get('', { action: 'get_day_schedules' });

            if (response.success) {
                this.daySchedules = response.data;
                this.renderDaySchedules(response.data);
            }

        } catch (error) {
            UI.showError(container, 'Failed to load day schedules');
        }
    },

    /**
     * Render day schedules list
     */
    renderDaySchedules(schedules) {
        const container = document.getElementById('day-schedules-list');

        if (schedules.length === 0) {
            container.innerHTML = '<p class="empty">No day schedules found. Click "Add Day Schedule" to create one.</p>';
            return;
        }

        const html = schedules.map(schedule => `
            <div class="schedule-card" data-id="${schedule.day_schedule_id}">
                <div class="schedule-header">
                    <h3>${schedule.name}</h3>
                    <span class="badge badge-${schedule.is_active ? 'success' : 'secondary'}">
                        ${schedule.is_active ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div class="schedule-body">
                    <p class="description">${schedule.description || 'No description'}</p>
                    <p class="meta">Type: ${schedule.schedule_type} | Periods: ${schedule.period_count}</p>
                </div>
                <div class="schedule-actions">
                    <button class="btn btn-sm btn-secondary" onclick="Schedules.editDaySchedule(${schedule.day_schedule_id})">
                        Edit
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="Schedules.viewPeriods(${schedule.day_schedule_id})">
                        View Periods
                    </button>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    },

    /**
     * Load week schedules from API
     */
    async loadWeekSchedules() {
        const container = document.getElementById('week-schedules-list');
        UI.showLoading(container);

        try {
            const response = await API.get('', { action: 'get_week_schedules' });

            if (response.success) {
                this.weekSchedules = response.data;
                this.renderWeekSchedules(response.data);
            }

        } catch (error) {
            UI.showError(container, 'Failed to load week schedules');
        }
    },

    /**
     * Render week schedules list
     */
    renderWeekSchedules(schedules) {
        const container = document.getElementById('week-schedules-list');

        if (schedules.length === 0) {
            container.innerHTML = '<p class="empty">No week schedules found. Click "Add Week Schedule" to create one.</p>';
            return;
        }

        const html = schedules.map(schedule => `
            <div class="schedule-card week-schedule" data-id="${schedule.week_schedule_id}">
                <div class="schedule-header">
                    <h3>${schedule.name}</h3>
                </div>
                <div class="schedule-body">
                    <p class="description">${schedule.description || 'No description'}</p>
                    <div class="week-grid">
                        <div class="day-item">
                            <strong>Mon:</strong> <span>${schedule.monday_name || 'Not set'}</span>
                        </div>
                        <div class="day-item">
                            <strong>Tue:</strong> <span>${schedule.tuesday_name || 'Not set'}</span>
                        </div>
                        <div class="day-item">
                            <strong>Wed:</strong> <span>${schedule.wednesday_name || 'Not set'}</span>
                        </div>
                        <div class="day-item">
                            <strong>Thu:</strong> <span>${schedule.thursday_name || 'Not set'}</span>
                        </div>
                        <div class="day-item">
                            <strong>Fri:</strong> <span>${schedule.friday_name || 'Not set'}</span>
                        </div>
                        <div class="day-item">
                            <strong>Sat:</strong> <span>${schedule.saturday_name || 'Not set'}</span>
                        </div>
                        <div class="day-item">
                            <strong>Sun:</strong> <span>${schedule.sunday_name || 'Not set'}</span>
                        </div>
                    </div>
                </div>
                <div class="schedule-actions">
                    <button class="btn btn-sm btn-secondary" onclick="Schedules.editWeekSchedule(${schedule.week_schedule_id})">
                        Edit
                    </button>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    },

    /**
     * Edit day schedule (placeholder)
     */
    editDaySchedule(scheduleId) {
        UI.showToast('Edit functionality to be implemented', 'info');
    },

    /**
     * View schedule periods (placeholder)
     */
    viewPeriods(scheduleId) {
        UI.showToast('View periods functionality to be implemented', 'info');
    },

    /**
     * Edit week schedule (placeholder)
     */
    editWeekSchedule(scheduleId) {
        UI.showToast('Edit functionality to be implemented', 'info');
    }
};
