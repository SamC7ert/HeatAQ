// API module - Handles all server communication

// Wraps fetch once for our own API (this file loads before every other module):
//
// 1. Retry on HTTP 429. The host's rate limiter rejects a request before PHP
//    runs, so nothing was saved and resending is safe. Waits Retry-After if
//    sent (capped), else 1s, 2s, 4s.
//
// 2. Share identical reads. Modules load the same lists independently (app
//    start sent 27 requests, only 16 distinct). A GET whose action starts with
//    get_ is shared: callers asking for the same URL while it is in flight, or
//    up to SHARE_MS after it answered, get a copy of that one response.
//    Any other request (POST, save_/delete_/switch_project, and GETs that write
//    such as fetch_and_store_year) clears all shared answers before and after
//    it runs, so a read following a change always goes to the server.
//
// auth_api is left alone: its 429 is a real password-reset limit.
(function () {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const nativeFetch = window.fetch.bind(window);
    const RETRIES = 3;
    const SHARE_MS = 3000;
    const NEVER_SHARE = ['get_run_progress'];  // live polling must stay fresh
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const shared = new Map();  // url -> { promise, expires (null while in flight) }

    async function fetchWithRetry(input, init, url) {
        for (let attempt = 0; ; attempt++) {
            const response = await nativeFetch(input, init);
            if (response.status !== 429 || attempt >= RETRIES) return response;
            const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
            const delay = Number.isFinite(retryAfter) ? Math.min(retryAfter, 10) * 1000 : 1000 * Math.pow(2, attempt);
            console.warn(`[api] HTTP 429 from host for ${url} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${RETRIES})`);
            await sleep(delay);
        }
    }

    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const isOwnApi = url.includes('/api/') && !url.includes('auth_api.php')
            && (!/^https?:\/\//i.test(url) || url.startsWith(window.location.origin));
        if (!isOwnApi) return nativeFetch(input, init);

        const method = ((init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();
        const action = decodeURIComponent((url.match(/[?&]action=([^&#]*)/) || [])[1] || '');
        const isRead = method === 'GET' && action.startsWith('get_');

        if (!isRead) {
            // May change data: drop shared answers now and once it completes
            shared.clear();
            const p = fetchWithRetry(input, init, url);
            p.then(() => shared.clear(), () => shared.clear());
            return p;
        }

        const bypass = NEVER_SHARE.includes(action)
            || (init && (init.cache === 'no-store' || init.cache === 'reload'));
        if (bypass) return fetchWithRetry(input, init, url);

        const now = Date.now();
        for (const [k, e] of shared) {
            if (e.expires !== null && e.expires <= now) shared.delete(k);
        }
        const hit = shared.get(url);
        if (hit) return hit.promise.then(r => r.clone());

        const entry = { promise: fetchWithRetry(input, init, url), expires: null };
        shared.set(url, entry);
        entry.promise.then(r => {
            if (shared.get(url) !== entry) return;  // cleared by a change meanwhile
            if (r.ok) entry.expires = Date.now() + SHARE_MS;
            else shared.delete(url);                // never share errors
        }, () => { if (shared.get(url) === entry) shared.delete(url); });
        return entry.promise.then(r => r.clone());
    };
})();

const api = {
    // Parse a response as JSON. When the server sends something else (a host
    // error page, a resource-limit 503/508 page, a firewall block), the plain
    // response.json() only says "Unexpected token '<'"; this names the HTTP
    // status and the page title so the real cause is visible.
    async parseJson(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            // Visible page text (host error pages put the reason in the body,
            // e.g. "Resource Limit Is Reached"); fall back to the <title>.
            const title = ((text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
            const bodyText = text
                .replace(/<head[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const snippet = (bodyText || title).slice(0, 160);
            const status = `HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''}`;
            throw new Error(`Server returned ${status} instead of data` + (snippet ? `: ${snippet}` : ' (empty response)'));
        }
    },

    // Generic API call function
    async call(action, params = {}, method = 'GET') {
        try {
            // Build URL as string (no URL objects for compatibility)
            let urlString = config.API_BASE_URL + '?action=' + action;

            for (const [key, value] of Object.entries(params)) {
                // Skip undefined, null, and empty strings
                if (value !== undefined && value !== null && value !== '') {
                    urlString += '&' + key + '=' + encodeURIComponent(value);
                }
            }
            
            // Actions that change data must be POSTed (the server rejects GET)
            const response = await fetch(urlString, method === 'GET' ? undefined : { method });
            const data = await api.parseJson(response);

            if (!response.ok) {
                // Server sent a JSON error body; prefer its message
                throw new Error(data.message || data.error || `HTTP error! status: ${response.status}`);
            }

            if (data.error) {
                console.error('API Error:', data.error);
                throw new Error(data.message || data.error);
            }

            return data;
        } catch (error) {
            console.error(`API call failed for ${action}:`, error);
            throw error;
        }
    },
    
    // POST request for saving data
    async post(action, data) {
        try {
            const response = await fetch(config.API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: action,
                    ...data
                })
            });

            // Always read the response body for error details
            const result = await api.parseJson(response);

            if (!response.ok || result.error) {
                const errorMsg = result.error || `HTTP error ${response.status}`;
                console.error('API Error:', errorMsg);
                throw new Error(errorMsg);
            }

            return result;
        } catch (error) {
            console.error(`API POST failed for ${action}:`, error);
            throw error;
        }
    },
    
    // Schedule Templates (OHC)
    templates: {
        async getAll() {
            return api.call('get_templates');
        },

        async getById(templateId) {
            return api.call('get_template', { template_id: templateId });
        },

        async save(data) {
            // Creates new or updates existing (based on template_id presence)
            return api.post('save_template', data);
        },

        async delete(templateId) {
            return api.post('delete_template', { template_id: templateId });
        }
    },

    // Day Schedules
    daySchedules: {
        async getAll() {
            return api.call('get_day_schedules');
        },

        async getById(scheduleId) {
            return api.call('get_day_schedule', { schedule_id: scheduleId });
        },

        async save(data) {
            // Creates new or updates existing (based on day_schedule_id presence)
            // data: { day_schedule_id?, name, is_closed, periods: [{start_time, end_time, target_temp, min_temp, max_temp}] }
            return api.post('save_day_schedule', data);
        },

        async delete(scheduleId) {
            return api.post('delete_day_schedule', { schedule_id: scheduleId });
        }
    },

    // Week Schedules
    weekSchedules: {
        async getAll() {
            return api.call('get_week_schedules');
        },

        async getById(scheduleId) {
            return api.call('get_week_schedule', { schedule_id: scheduleId });
        },

        async save(data) {
            // Creates new or updates existing (based on week_schedule_id presence)
            // data: { week_schedule_id?, name, monday_schedule_id, tuesday_schedule_id, ... }
            return api.post('save_week_schedule', data);
        },

        async delete(scheduleId) {
            return api.post('delete_week_schedule', { schedule_id: scheduleId });
        }
    },
    
    // Calendar - Date Ranges and Exception Days
    calendar: {
        async getRules(templateId) {
            return api.call('get_calendar_rules', { template_id: templateId });
        },

        async getExceptionDays(templateId) {
            return api.call('get_exception_days', { template_id: templateId });
        },

        async getReferenceDays() {
            return api.call('get_reference_days');
        },

        // Date Ranges
        async saveDateRange(data) {
            // data: { range_id?, template_id, week_schedule_id, start_date, end_date, priority }
            return api.post('save_date_range', data);
        },

        async deleteDateRange(rangeId) {
            return api.call('delete_date_range', { range_id: rangeId }, 'POST');
        },

        // Exception Days
        async saveExceptionDay(data) {
            // data: { exception_id?, template_id, name, day_schedule_id, is_moving, easter_offset_days?, fixed_month?, fixed_day? }
            return api.post('save_exception_day', data);
        },

        async deleteExceptionDay(exceptionId) {
            return api.call('delete_exception_day', { exception_id: exceptionId }, 'POST');
        },

        async testResolution(date, templateId) {
            return api.call('resolve_schedule', { date: date, template_id: templateId });
        }
    },
    
    // Utility functions
    utils: {
        // Show error message to user
        showError(message) {
            // TODO: Implement proper error notification
            console.error('Error:', message);
            alert('Error: ' + message);
        },
        
        // Show success message
        showSuccess(message) {
            // TODO: Implement proper success notification
            console.log('Success:', message);
        },
        
        // Handle API errors consistently
        handleError(error) {
            const message = error.message || 'An unexpected error occurred';
            this.showError(message);
        }
    }
};

// Make API module globally available
window.api = api;
