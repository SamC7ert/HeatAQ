// Project Management Module

const ProjectModule = {
    currentProject: null,
    projects: [],
    currentSite: null,
    weatherStations: [],

    // Load project data
    async load() {
        console.log('[Project] load() starting...');
        try {
            // Load current project from localStorage
            const projectId = localStorage.getItem('heataq_project');
            const projectName = localStorage.getItem('heataq_project_name') || 'Default Project';
            const projectDesc = localStorage.getItem('heataq_project_desc') || '';

            this.currentProject = {
                id: projectId,
                name: projectName,
                description: projectDesc
            };
            console.log('[Project] currentProject:', this.currentProject);

            // Set project cookie so API can filter by project_id
            if (projectId) {
                document.cookie = `heataq_project=${projectId}; path=/; max-age=31536000`;
            }

            // Update display
            this.updateDisplay();

            // Load site data
            console.log('[Project] Loading site data...');
            await this.loadSiteData();

            // Load pool data (must await before updatePoolCard)
            console.log('[Project] Loading pool data...');
            await this.loadPoolData();

            // Load project summary
            console.log('[Project] Loading summary...');
            await this.loadSummary();

            // Update pool card
            console.log('[Project] Updating pool card...');
            await this.updatePoolCard();

            // Load projects list
            console.log('[Project] Loading projects list...');
            await this.loadProjectsList();
            console.log('[Project] load() completed');
        } catch (error) {
            console.error('[Project] Error loading project:', error);
        }
    },

    // Load site data from API (always fetch to ensure correct project)
    async loadSiteData() {
        try {
            // ALWAYS fetch from API with explicit project_id parameter
            // Cannot rely on cookies - they don't update until next request
            const projectId = this.currentProject?.id;
            const url = projectId
                ? `${config.API_BASE_URL}?action=get_sites&project_id=${projectId}`
                : `${config.API_BASE_URL}?action=get_sites`;
            const response = await fetch(url);
            const result = await response.json();
            console.log('[Project] get_sites response for project', projectId, ':', result);

            if (result.sites && result.sites.length > 0) {
                // Use first site for current project
                const dbSite = result.sites[0];
                this.currentSite = {
                    id: dbSite.id,  // INT pool_site_id
                    name: dbSite.name,
                    latitude: parseFloat(dbSite.latitude) || null,
                    longitude: parseFloat(dbSite.longitude) || null,
                    weather_station_id: dbSite.weather_station_id,
                };
                console.log('[Project] Loaded site from DB, id:', this.currentSite.id);
                // Save to localStorage
                localStorage.setItem('heataq_site', JSON.stringify(this.currentSite));
                // Set cookie for API
                document.cookie = `heataq_pool_site_id=${this.currentSite.id}; path=/; max-age=31536000`;
            } else {
                // No site for this project - clear any stale data
                console.log('[Project] No pool_site found for project', this.currentProject?.id);
                localStorage.removeItem('heataq_site');
                document.cookie = 'heataq_pool_site_id=; path=/; max-age=0';
                this.currentSite = {
                    id: null,
                    name: 'No Site Configured',
                    latitude: null,
                    longitude: null,
                    weather_station_id: null,
                };
            }

            // Fallback to default if still no site object
            if (!this.currentSite) {
                this.currentSite = {
                    id: null,
                    name: 'No Site',
                    latitude: null,
                    longitude: null,
                    weather_station_id: null,
                    weather_station_name: null,
                    pools: []
                };
            }

            // Update site display
            this.updateSiteDisplay();

            // Load weather stations
            await this.loadWeatherStations();
        } catch (error) {
            console.error('Error loading site data:', error);
        }
    },

    // Update site card display
    updateSiteDisplay() {
        const site = this.currentSite;
        if (!site) return;

        // Check if site is configured (has an id)
        const hasSite = site.id != null;

        // Update name
        const nameEl = document.getElementById('site-name');
        if (nameEl) nameEl.textContent = hasSite ? (site.name || 'Unnamed Site') : 'No Site Configured';

        // Update debug ID
        const debugIdEl = document.getElementById('site-debug-id');
        if (debugIdEl) debugIdEl.textContent = `Site ID: ${site.id || '-'}`;

        // Update location
        const locationEl = document.getElementById('site-location');
        if (locationEl) {
            if (site.latitude && site.longitude) {
                locationEl.textContent = this.getLocationName(site.latitude, site.longitude);
            } else {
                locationEl.textContent = 'Location not set';
            }
        }

        // Update coordinates
        const latEl = document.getElementById('site-latitude');
        const lngEl = document.getElementById('site-longitude');
        if (latEl) latEl.textContent = site.latitude ? `${site.latitude.toFixed(4)}°N` : '-';
        if (lngEl) lngEl.textContent = site.longitude ? `${site.longitude.toFixed(4)}°E` : '-';

        // Update weather station
        const wsEl = document.getElementById('site-weather-station');
        if (wsEl) wsEl.textContent = site.weather_station_name || 'Not connected';

        // Update solar estimate
        const solarEl = document.getElementById('site-solar');
        if (solarEl) {
            if (site.latitude) {
                const solar = this.estimateSolar(site.latitude);
                solarEl.textContent = `~${solar} kWh/m²/yr`;
            } else {
                solarEl.textContent = '-';
            }
        }

        // Update map
        this.updateMapPreview('site-map', site.latitude, site.longitude);

        // Update pools list
        this.updatePoolsList();

        // Update dashboard weather station
        const dashWs = document.getElementById('dash-weather-station');
        if (dashWs) dashWs.textContent = site.weather_station_name || '-';
    },

    // Get approximate location name from coordinates
    getLocationName(lat, lng) {
        // Simple approximation for Norway
        if (lat >= 69) return 'Northern Norway';
        if (lat >= 63) return 'Central Norway';
        if (lat >= 60) return 'Western Norway';
        if (lat >= 58) return 'Southern Norway';
        return `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`;
    },

    // Estimate annual solar radiation based on latitude
    estimateSolar(latitude) {
        // Rough estimates for Norway latitudes (kWh/m²/year)
        if (latitude >= 70) return 700;
        if (latitude >= 67) return 780;
        if (latitude >= 64) return 850;
        if (latitude >= 62) return 920;
        if (latitude >= 60) return 980;
        if (latitude >= 58) return 1050;
        return 1100;
    },

    // Update map preview
    updateMapPreview(containerId, lat, lng) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (lat && lng) {
            // Use OpenStreetMap embed iframe (more reliable than static image)
            const zoom = 17; // High zoom for good detail
            const bbox = this.calculateBbox(lat, lng, zoom);
            const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
            container.innerHTML = `<iframe src="${embedUrl}" style="width:100%;height:100%;border:none;" loading="lazy"></iframe>`;
        } else {
            container.innerHTML = `<div class="site-map-placeholder"><div>🗺️</div><div>Enter coordinates to show map</div></div>`;
        }
    },

    // Calculate bounding box for map embed
    calculateBbox(lat, lng, zoom) {
        // Approximate bbox calculation for given zoom level
        const latDelta = 0.01 * Math.pow(2, 14 - zoom);
        const lngDelta = 0.015 * Math.pow(2, 14 - zoom);
        const west = lng - lngDelta;
        const south = lat - latDelta;
        const east = lng + lngDelta;
        const north = lat + latDelta;
        return `${west},${south},${east},${north}`;
    },

    // Fetch NASA solar data for site coordinates
    async fetchNasaSolar() {
        const lat = parseFloat(document.getElementById('edit-site-lat')?.value);
        const lng = parseFloat(document.getElementById('edit-site-lng')?.value);

        if (!lat || !lng) {
            alert('Please enter latitude and longitude first');
            return;
        }

        const btn = document.getElementById('btn-fetch-solar');
        const statusEl = document.getElementById('solar-fetch-status');

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Fetching...';
        }
        if (statusEl) {
            statusEl.textContent = 'Fetching 10 years of solar data from NASA POWER API...';
            statusEl.style.color = '#666';
        }

        try {
            const response = await fetch(`${config.API_BASE_URL}?action=fetch_nasa_solar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: lat,
                    longitude: lng,
                    start_year: new Date().getFullYear() - 10,
                    end_year: new Date().getFullYear() - 1
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            // Update site with fetch info
            this.currentSite.solar_last_fetched = new Date().toISOString();
            this.currentSite.solar_days = result.daily_records;
            localStorage.setItem('heataq_site', JSON.stringify(this.currentSite));

            // Update status display
            this.updateSolarStatus();

            console.log('[Project] NASA solar data fetched:', result);

        } catch (error) {
            console.error('[Project] NASA solar fetch error:', error);
            if (statusEl) {
                statusEl.textContent = `✗ Error: ${error.message}`;
                statusEl.style.color = '#dc3545';
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Fetch Solar Data';
            }
        }
    },

    // Update pools list in site card
    updatePoolsList() {
        const listEl = document.getElementById('site-pools-list');
        if (!listEl) return;

        // Get pools from configuration if available
        let pools = this.currentSite?.pools || [];

        if (typeof app.configuration !== 'undefined') {
            const config = app.configuration.getConfig();
            if (config?.pool) {
                pools = [{
                    name: 'Main Pool',
                    volume: config.pool.volume,
                    surface_area: config.pool.surface_area
                }];
            }
        }

        if (pools.length > 0) {
            listEl.innerHTML = pools.map(pool =>
                `<li>${pool.name} <span class="pool-volume">${pool.volume || '-'} m³</span></li>`
            ).join('');

            // Update dashboard
            const poolCountEl = document.getElementById('dash-pool-count');
            const totalVolEl = document.getElementById('dash-total-volume');
            if (poolCountEl) poolCountEl.textContent = pools.length;
            if (totalVolEl) {
                const totalVol = pools.reduce((sum, p) => sum + (p.volume || 0), 0);
                totalVolEl.textContent = totalVol > 0 ? `${totalVol} m³` : '-';
            }
        } else {
            listEl.innerHTML = '<li class="text-muted">No pools configured</li>';
        }
    },

    // Load weather stations
    async loadWeatherStations() {
        try {
            const response = await fetch(`${config.API_BASE_URL}?action=get_weather_stations`);
            if (response.ok) {
                const data = await response.json();
                // Handle both array and object with stations property
                this.weatherStations = Array.isArray(data) ? data : (data.stations || []);
                console.log('[Project] Loaded weather stations:', this.weatherStations.length);

                // Look up station name for current site and update display
                if (this.currentSite?.weather_station_id && this.weatherStations.length > 0) {
                    const station = this.weatherStations.find(ws => ws.station_id === this.currentSite.weather_station_id);
                    if (station) {
                        this.currentSite.weather_station_name = station.name;
                        // Update display with the station name
                        const wsEl = document.getElementById('site-weather-station');
                        if (wsEl) wsEl.textContent = station.name;
                    }
                }
            } else {
                console.warn('[Project] Weather stations API returned:', response.status);
                this.weatherStations = [];
            }
        } catch (error) {
            console.error('[Project] Error loading weather stations:', error);
            this.weatherStations = [];
        }
    },

    // Edit site - show modal
    async editSite() {
        const modal = document.getElementById('edit-site-modal');
        if (!modal) return;

        // Ensure weather stations are loaded
        if (this.weatherStations.length === 0) {
            await this.loadWeatherStations();
        }

        const site = this.currentSite || {};
        console.log('[Project] Editing site:', site);

        // Populate form
        const nameEl = document.getElementById('edit-site-name');
        const latEl = document.getElementById('edit-site-lat');
        const lngEl = document.getElementById('edit-site-lng');

        if (nameEl) nameEl.value = site.name || '';
        if (latEl) latEl.value = site.latitude || '';
        if (lngEl) lngEl.value = site.longitude || '';

        // Populate weather station dropdown
        const wsSelect = document.getElementById('edit-site-weather');
        if (wsSelect) {
            wsSelect.innerHTML = '<option value="">-- Select Weather Station --</option>';
            console.log('[Project] Populating weather stations:', this.weatherStations.length);
            this.weatherStations.forEach(ws => {
                const selected = ws.station_id === site.weather_station_id ? 'selected' : '';
                wsSelect.innerHTML += `<option value="${ws.station_id}" ${selected}>${ws.name || ws.station_name} (${ws.station_id})</option>`;
            });
        }

        // Update solar estimate
        this.updateSolarEstimate();

        // Update map preview in modal
        this.updateMapPreview('site-map-preview', site.latitude, site.longitude);

        // Show solar data status
        this.updateSolarStatus();

        // Add event listeners for coordinate changes (remove old ones first to avoid duplicates)
        const newLatEl = document.getElementById('edit-site-lat');
        const newLngEl = document.getElementById('edit-site-lng');
        if (newLatEl) {
            newLatEl.onchange = () => this.onCoordinateChange();
            newLatEl.oninput = () => this.onCoordinateChange();
        }
        if (newLngEl) {
            newLngEl.onchange = () => this.onCoordinateChange();
            newLngEl.oninput = () => this.onCoordinateChange();
        }

        // Populate investment cost fields
        const hpBaseEl = document.getElementById('edit-site-hp-base');
        const hpMarginalEl = document.getElementById('edit-site-hp-marginal');
        const boilerBaseEl = document.getElementById('edit-site-boiler-base');
        const boilerMarginalEl = document.getElementById('edit-site-boiler-marginal');
        if (hpBaseEl) hpBaseEl.value = site.hp_base_cost_nok || '';
        if (hpMarginalEl) hpMarginalEl.value = site.hp_marginal_cost_per_kw || '';
        if (boilerBaseEl) boilerBaseEl.value = site.boiler_base_cost_nok || '';
        if (boilerMarginalEl) boilerMarginalEl.value = site.boiler_marginal_cost_per_kw || '';

        // Update modal title for edit mode
        const titleEl = modal.querySelector('h3');
        if (titleEl) titleEl.textContent = 'Edit Site';

        modal.style.display = 'flex';
    },

    // Update solar data status display - check database for actual data
    async updateSolarStatus() {
        const statusEl = document.getElementById('solar-fetch-status');
        const lastUpdatedEl = document.getElementById('solar-last-updated');

        if (!statusEl) return;

        // Show loading state
        statusEl.textContent = 'Checking solar data...';
        statusEl.style.color = '#666';

        try {
            // Call API to get actual solar data status from database
            const response = await fetch(`${config.API_BASE_URL}?action=get_solar_status`);
            const result = await response.json();

            if (result.has_data) {
                // Format date range
                const startDate = result.data_start ? new Date(result.data_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '?';
                const endDate = result.data_end ? new Date(result.data_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '?';
                statusEl.textContent = `✓ Solar data: ${startDate} to ${endDate} (${result.day_count} days)`;
                statusEl.style.color = '#28a745';

                if (lastUpdatedEl) {
                    lastUpdatedEl.textContent = `${result.hour_count.toLocaleString()} hourly records`;
                }
            } else {
                statusEl.textContent = 'Not fetched - click to load 10 years of hourly solar radiation data';
                statusEl.style.color = '#666';
                if (lastUpdatedEl) lastUpdatedEl.textContent = '';
            }
        } catch (error) {
            console.error('[Project] Error checking solar status:', error);
            // Fallback to localStorage check
            const site = this.currentSite || {};
            if (site.solar_last_fetched) {
                statusEl.textContent = `✓ Solar data loaded (${site.solar_days || '?'} days)`;
                statusEl.style.color = '#28a745';
            } else {
                statusEl.textContent = 'Not fetched - click to load 10 years of hourly solar radiation data';
                statusEl.style.color = '#666';
            }
        }
    },

    // Handle coordinate change in edit modal
    onCoordinateChange() {
        const lat = parseFloat(document.getElementById('edit-site-lat').value);
        const lng = parseFloat(document.getElementById('edit-site-lng').value);

        this.updateSolarEstimate();
        this.updateMapPreview('site-map-preview', lat || null, lng || null);
    },

    // Update solar estimate in modal
    updateSolarEstimate() {
        const lat = parseFloat(document.getElementById('edit-site-lat').value);
        const solarEl = document.getElementById('edit-site-solar-estimate');

        if (solarEl) {
            if (lat && lat >= 50 && lat <= 75) {
                solarEl.textContent = `~${this.estimateSolar(lat)} kWh/m²/yr`;
            } else {
                solarEl.textContent = '-';
            }
        }
    },

    // Hide site modal
    hideSiteModal() {
        const modal = document.getElementById('edit-site-modal');
        if (modal) modal.style.display = 'none';
    },

    // Save site
    async saveSite() {
        const nameEl = document.getElementById('edit-site-name');
        const latEl = document.getElementById('edit-site-lat');
        const lngEl = document.getElementById('edit-site-lng');
        const wsEl = document.getElementById('edit-site-weather');
        const hpBaseEl = document.getElementById('edit-site-hp-base');
        const hpMarginalEl = document.getElementById('edit-site-hp-marginal');
        const boilerBaseEl = document.getElementById('edit-site-boiler-base');
        const boilerMarginalEl = document.getElementById('edit-site-boiler-marginal');

        const name = nameEl?.value?.trim() || '';
        const latRaw = latEl?.value;
        const lngRaw = lngEl?.value;
        const lat = latRaw ? parseFloat(latRaw) : null;
        const lng = lngRaw ? parseFloat(lngRaw) : null;
        const wsId = wsEl?.value || null;
        const hpBase = hpBaseEl?.value ? parseFloat(hpBaseEl.value) : null;
        const hpMarginal = hpMarginalEl?.value ? parseFloat(hpMarginalEl.value) : null;
        const boilerBase = boilerBaseEl?.value ? parseFloat(boilerBaseEl.value) : null;
        const boilerMarginal = boilerMarginalEl?.value ? parseFloat(boilerMarginalEl.value) : null;

        // Check if coordinates changed
        const oldLat = this.currentSite?.latitude;
        const oldLng = this.currentSite?.longitude;
        const coordsChanged = lat && lng && (lat !== oldLat || lng !== oldLng);

        console.log('[Project] Save - Coords changed:', coordsChanged, { old: [oldLat, oldLng], new: [lat, lng] });

        // Find weather station name
        let wsName = null;
        if (wsId) {
            const ws = this.weatherStations.find(w => w.station_id === wsId);
            if (ws) wsName = ws.name || ws.station_name;
        }

        // Update site object - use INT id
        this.currentSite = {
            ...this.currentSite,
            name: name || 'Main Site',
            latitude: lat,
            longitude: lng,
            weather_station_id: wsId,
            weather_station_name: wsName,
            hp_base_cost_nok: hpBase,
            hp_marginal_cost_per_kw: hpMarginal,
            boiler_base_cost_nok: boilerBase,
            boiler_marginal_cost_per_kw: boilerMarginal
        };

        // Validate project_id before saving
        const projectId = this.currentProject?.id;
        if (!projectId) {
            console.error('[Project] Cannot save site: no currentProject.id set');
            alert('Error: No project selected. Please select a project first.');
            return;
        }

        console.log('[Project] Saving site with project_id:', projectId, 'currentProject:', this.currentProject);

        // Save to database via API - uses INT id
        try {
            const payload = {
                id: this.currentSite.id || null,  // INT pool_site_id, null for new
                project_id: projectId,  // Required for new sites - validated above
                name: name,
                latitude: lat,
                longitude: lng,
                weather_station_id: wsId,
                hp_base_cost_nok: hpBase,
                hp_marginal_cost_per_kw: hpMarginal,
                boiler_base_cost_nok: boilerBase,
                boiler_marginal_cost_per_kw: boilerMarginal
            };
            console.log('[Project] Save site payload:', JSON.stringify(payload));

            const response = await fetch(`${config.API_BASE_URL}?action=save_site`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.error) {
                console.error('[Project] Failed to save site to DB:', result.error);
                alert('Failed to save site: ' + result.error);
                return;
            } else {
                console.log('[Project] Site saved to database:', result);
                // Update id if server assigned one (for new sites)
                if (result.id) {
                    this.currentSite.id = result.id;
                    // Set cookie for API to use
                    document.cookie = `heataq_pool_site_id=${result.id}; path=/; max-age=31536000`;
                }
            }
        } catch (err) {
            console.error('[Project] API error saving site:', err);
        }

        // Save to localStorage
        localStorage.setItem('heataq_site', JSON.stringify(this.currentSite));

        // Update display
        this.updateSiteDisplay();
        this.hideSiteModal();

        console.log('[Project] Site saved:', this.currentSite);

        // Reload pool data for the new/updated site
        // This ensures pools are filtered by the current site's pool_site_id
        await this.loadPoolData();
        await this.updatePoolCard();

        // Auto-fetch NASA solar data if coordinates changed
        if (coordsChanged) {
            console.log('[Project] Coordinates changed - fetching NASA solar data...');
            // Small delay to let modal close
            setTimeout(() => this.fetchNasaSolarBackground(lat, lng), 500);
        }
    },

    // Fetch NASA solar data in background (after save)
    async fetchNasaSolarBackground(lat, lng) {
        try {
            console.log('[Project] Background NASA fetch for:', lat, lng);

            const response = await fetch(`${config.API_BASE_URL}?action=fetch_nasa_solar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: lat,
                    longitude: lng,
                    start_year: new Date().getFullYear() - 10,
                    end_year: new Date().getFullYear() - 1
                })
            });

            const result = await response.json();

            if (result.error) {
                console.error('[Project] NASA solar fetch error:', result.error);
                return;
            }

            // Update site with fetch info
            this.currentSite.solar_last_fetched = new Date().toISOString();
            this.currentSite.solar_days = result.daily_records;
            localStorage.setItem('heataq_site', JSON.stringify(this.currentSite));

            console.log('[Project] NASA solar data fetched:', result);

            // Show notification
            this.showNotification(`Solar data loaded: ${result.daily_records} days from NASA`, 'success');

        } catch (error) {
            console.error('[Project] NASA solar background fetch error:', error);
        }
    },

    // Show a brief notification
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 12px 20px;
            background: ${type === 'success' ? '#28a745' : '#007bff'}; color: white;
            border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 10000; font-size: 14px; animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 4000);
    },

    // Populate weather station dropdown
    async populateWeatherStationDropdown(selectedId = null) {
        // Ensure weather stations are loaded
        if (this.weatherStations.length === 0) {
            await this.loadWeatherStations();
        }

        const wsSelect = document.getElementById('edit-site-weather');
        if (wsSelect) {
            wsSelect.innerHTML = '<option value="">-- Select Weather Station --</option>';
            this.weatherStations.forEach(ws => {
                const selected = ws.station_id === selectedId ? 'selected' : '';
                wsSelect.innerHTML += `<option value="${ws.station_id}" ${selected}>${ws.name || ws.station_name} (${ws.station_id})</option>`;
            });
        }
    },

    // Show add site modal - opens edit modal with empty fields for creating new site
    async showAddSiteModal() {
        const modal = document.getElementById('edit-site-modal');
        if (!modal) return;

        // Clear form for new site
        document.getElementById('edit-site-name').value = '';
        document.getElementById('edit-site-lat').value = '';
        document.getElementById('edit-site-lng').value = '';
        document.getElementById('edit-site-weather').value = '';
        document.getElementById('edit-site-hp-base').value = '';
        document.getElementById('edit-site-hp-marginal').value = '';
        document.getElementById('edit-site-boiler-base').value = '';
        document.getElementById('edit-site-boiler-marginal').value = '';

        // Reset displays
        const solarEl = document.getElementById('edit-site-solar-estimate');
        if (solarEl) solarEl.textContent = '-';
        const statusEl = document.getElementById('solar-fetch-status');
        if (statusEl) statusEl.textContent = 'Not fetched - click to load 10 years of hourly solar radiation data';
        const mapEl = document.getElementById('site-map-preview');
        if (mapEl) mapEl.innerHTML = 'Enter coordinates to preview map';

        // Update modal title
        const titleEl = modal.querySelector('h3');
        if (titleEl) titleEl.textContent = 'Add New Site';

        // Mark as new site (clear id)
        this.currentSite = {
            id: null,
            name: '',
            latitude: null,
            longitude: null,
            weather_station_id: null
        };

        // Load weather stations for dropdown
        await this.populateWeatherStationDropdown();

        modal.style.display = 'flex';
    },

    // Show add pool modal - opens edit modal with empty fields for creating new pool
    showAddPoolModal() {
        // Check if we have a site to add pool to
        if (!this.currentSite?.id) {
            alert('Please create a site first before adding pools.');
            return;
        }

        const modal = document.getElementById('edit-pool-modal');
        if (!modal) return;

        // Clear form for new pool
        document.getElementById('edit-pool-name').value = '';
        document.getElementById('edit-pool-length').value = '';
        document.getElementById('edit-pool-width').value = '';
        document.getElementById('edit-pool-depth').value = '';
        document.getElementById('edit-pool-wind').value = '0.5';
        document.getElementById('edit-pool-solar').value = '60';
        document.getElementById('edit-pool-has-cover').value = '1';
        document.getElementById('edit-pool-cover-u').value = '5.0';
        document.getElementById('edit-pool-cover-solar').value = '10';
        document.getElementById('edit-pool-has-tunnel').value = '1';
        document.getElementById('edit-pool-floor-insulated').value = '1';

        // Reset dimensions display
        this.calcPoolDimensions();

        // Update modal title
        const titleEl = modal.querySelector('h3');
        if (titleEl) titleEl.textContent = 'Add New Pool';

        // Mark as new pool (clear id)
        this.currentPool = {
            pool_id: null,
            name: '',
            length: null,
            width: null,
            depth: null
        };
        this.currentPoolId = null;

        modal.style.display = 'flex';
    },

    // Current pool data
    currentPool: null,
    currentPoolId: null,

    // Load pool data from database (with localStorage fallback)
    async loadPoolData() {
        try {
            // If no pool_site configured, set empty pool
            if (!this.currentSite?.id) {
                console.log('[Project] No pool_site configured, cannot load pools');
                this.currentPool = {
                    pool_id: null,
                    name: 'No Pool',
                    length: null,
                    width: null,
                    depth: null,
                    area: null,
                    volume: null
                };
                this.currentPoolId = null;
                return;
            }

            // Build URL with pool_site_id (INT)
            let url = `./api/heataq_api.php?action=get_pools&pool_site_id=${encodeURIComponent(this.currentSite.id)}`;
            console.log('[Project] Fetching pools from:', url);

            // Try to load from database first
            const response = await fetch(url);
            const data = await response.json();
            console.log('[Project] get_pools response:', data);

            if (data.pools && data.pools.length > 0) {
                // Use first pool (or could allow selection)
                const dbPool = data.pools[0];
                console.log('[Project] Loading pool from DB:', dbPool);
                this.currentPoolId = dbPool.pool_id;
                this.currentPool = {
                    pool_id: dbPool.pool_id,
                    name: dbPool.name,
                    length: parseFloat(dbPool.length_m) || 25,
                    width: parseFloat(dbPool.width_m) || 12.5,
                    depth: parseFloat(dbPool.depth_m) || 2.0,
                    area: parseFloat(dbPool.area_m2) || 312.5,
                    volume: parseFloat(dbPool.volume_m3) || 625,
                    // NB: 0 is a legitimate value ("0 = sheltered") — use an
                    // isFinite check, not ||, so 0 isn't replaced by the default.
                    wind_exposure: Number.isFinite(parseFloat(dbPool.wind_exposure)) ? parseFloat(dbPool.wind_exposure) : 0.5,
                    solar_absorption: parseFloat(dbPool.solar_absorption) || 60,
                    has_cover: dbPool.has_cover == 1,
                    cover_u_value: parseFloat(dbPool.cover_r_value) || 5.0,
                    cover_solar_trans: parseFloat(dbPool.cover_solar_transmittance) || 10,
                    has_tunnel: dbPool.has_tunnel == 1,
                    floor_insulated: dbPool.floor_insulated == 1
                };
                console.log('[Project] Pool loaded from database:', this.currentPool);
                return;
            } else {
                // No pools for this site/project - set empty placeholder
                console.log('[Project] No pools for pool_site_id:', data.pool_site_id);
                this.currentPool = {
                    pool_id: null,
                    name: 'No Pool Configured',
                    length: null,
                    width: null,
                    depth: null,
                    area: null,
                    volume: null
                };
                this.currentPoolId = null;
                return;
            }
        } catch (err) {
            console.warn('[Project] Failed to load pool from database, using localStorage:', err);
        }

        // Fallback to localStorage
        const poolData = localStorage.getItem('heataq_pool');
        if (poolData) {
            this.currentPool = JSON.parse(poolData);
            console.warn('[Project] Using localStorage pool (NOT from DB):', this.currentPool);
        } else {
            // Default pool matching benchmark
            console.warn('[Project] Using HARDCODED DEFAULT pool (NOT from DB!)');
            this.currentPool = {
                name: 'Main Pool',
                length: 25,
                width: 12.5,
                depth: 2.0,
                area: 312.5,
                volume: 625,
                wind_exposure: 0.5,
                solar_absorption: 60,
                has_cover: true,
                cover_u_value: 5.0,
                cover_solar_trans: 10,
                has_tunnel: true,
                floor_insulated: true
            };
        }
    },

    // Edit pool - show modal
    async editPool() {
        const modal = document.getElementById('edit-pool-modal');
        if (!modal) return;

        // Load pool data if not loaded
        if (!this.currentPool) {
            await this.loadPoolData();
        }

        const pool = this.currentPool;

        // Populate form
        document.getElementById('edit-pool-name').value = pool.name || 'Main Pool';
        document.getElementById('edit-pool-length').value = pool.length || '';
        document.getElementById('edit-pool-width').value = pool.width || '';
        document.getElementById('edit-pool-depth').value = pool.depth || '';
        document.getElementById('edit-pool-wind').value = pool.wind_exposure ?? 0.5;
        document.getElementById('edit-pool-solar').value = pool.solar_absorption ?? 60;
        document.getElementById('edit-pool-has-cover').value = pool.has_cover ? '1' : '0';
        document.getElementById('edit-pool-cover-u').value = pool.cover_u_value ?? 5.0;
        document.getElementById('edit-pool-cover-solar').value = pool.cover_solar_trans ?? 10;
        document.getElementById('edit-pool-has-tunnel').value = pool.has_tunnel ? '1' : '0';
        document.getElementById('edit-pool-floor-insulated').value = pool.floor_insulated ? '1' : '0';
        document.getElementById('edit-pool-years').value = pool.years_operating ?? 3;

        // Calculate and show dimensions
        this.calcPoolDimensions();
        this.togglePoolCover();

        // Update modal title for edit mode
        const titleEl = modal.querySelector('h3');
        if (titleEl) titleEl.textContent = 'Edit Pool';

        modal.style.display = 'flex';
    },

    // Hide pool modal
    hidePoolModal() {
        const modal = document.getElementById('edit-pool-modal');
        if (modal) modal.style.display = 'none';
    },

    // Calculate pool dimensions from length/width/depth
    calcPoolDimensions() {
        const length = parseFloat(document.getElementById('edit-pool-length')?.value) || 0;
        const width = parseFloat(document.getElementById('edit-pool-width')?.value) || 0;
        const depth = parseFloat(document.getElementById('edit-pool-depth')?.value) || 0;

        const area = length * width;
        const volume = area * depth;

        document.getElementById('calc-pool-area').textContent = area > 0 ? `${area.toFixed(1)} m²` : '- m²';
        document.getElementById('calc-pool-volume').textContent = volume > 0 ? `${volume.toFixed(1)} m³` : '- m³';
    },

    // Toggle pool cover settings visibility
    togglePoolCover() {
        const hasCover = document.getElementById('edit-pool-has-cover')?.value === '1';
        const settings = document.getElementById('pool-cover-settings');
        if (settings) {
            settings.style.display = hasCover ? 'grid' : 'none';
        }
    },

    // Save pool to database (with localStorage backup)
    async savePool() {
        const length = parseFloat(document.getElementById('edit-pool-length')?.value) || 0;
        const width = parseFloat(document.getElementById('edit-pool-width')?.value) || 0;
        const depth = parseFloat(document.getElementById('edit-pool-depth')?.value) || 0;

        const poolData = {
            pool_id: this.currentPoolId || null,
            pool_site_id: this.currentSite?.id,  // Required for new pools
            name: document.getElementById('edit-pool-name')?.value?.trim() || 'Main Pool',
            length_m: length,
            width_m: width,
            depth_m: depth,
            // NB: 0 is legitimate ("0 = sheltered") — don't let || replace it.
            wind_exposure: Number.isFinite(parseFloat(document.getElementById('edit-pool-wind')?.value)) ? parseFloat(document.getElementById('edit-pool-wind').value) : 0.5,
            solar_absorption: parseFloat(document.getElementById('edit-pool-solar')?.value) || 60,
            has_cover: document.getElementById('edit-pool-has-cover')?.value === '1',
            cover_r_value: parseFloat(document.getElementById('edit-pool-cover-u')?.value) || 5.0,
            cover_solar_transmittance: parseFloat(document.getElementById('edit-pool-cover-solar')?.value) || 10,
            has_tunnel: document.getElementById('edit-pool-has-tunnel')?.value === '1',
            floor_insulated: document.getElementById('edit-pool-floor-insulated')?.value === '1',
            years_operating: parseInt(document.getElementById('edit-pool-years')?.value) || 3
        };

        // Validate we have a site
        if (!poolData.pool_site_id) {
            console.error('[Project] Cannot save pool: no currentSite.id set');
            alert('Error: No site configured. Please create a site first.');
            return;
        }

        console.log('[Project] Saving pool with pool_site_id:', poolData.pool_site_id, 'currentSite:', this.currentSite);

        // Update local state
        this.currentPool = {
            ...poolData,
            length: length,
            width: width,
            depth: depth,
            area: length * width,
            volume: length * width * depth,
            cover_u_value: poolData.cover_r_value,
            cover_solar_trans: poolData.cover_solar_transmittance
        };

        // Always save to localStorage as backup
        localStorage.setItem('heataq_pool', JSON.stringify(this.currentPool));

        // Try to save to database
        try {
            const response = await fetch('./api/heataq_api.php?action=save_pool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(poolData)
            });

            const result = await response.json();

            if (result.success) {
                this.currentPoolId = result.pool_id;
                this.currentPool.pool_id = result.pool_id;
                console.log('[Project] Pool saved to database:', result.pool_id);
            } else {
                console.warn('[Project] Failed to save pool to database:', result.error);
            }
        } catch (err) {
            console.warn('[Project] Database save failed, using localStorage only:', err);
        }

        // Update displays
        this.updatePoolCard();
        this.hidePoolModal();

        // Refresh the SimControl "From Pool Settings" values (Wind Exposure,
        // Solar Absorption) so they reflect the edit without a page reload.
        if (typeof SimulationsModule !== 'undefined' && SimulationsModule.refreshPoolValues) {
            SimulationsModule.refreshPoolValues();
        }

        console.log('[Project] Pool saved:', this.currentPool);
    },

    // Update pool card display
    async updatePoolCard() {
        // Load pool data if not loaded
        if (!this.currentPool) {
            await this.loadPoolData();
        }

        const pool = this.currentPool;
        const cfg = typeof app.configuration !== 'undefined' ? app.configuration.getConfig() : null;

        // Pool name
        const nameEl = document.getElementById('pool-name');
        if (nameEl) nameEl.textContent = pool.name || 'Main Pool';

        // Pool debug ID
        const debugIdEl = document.getElementById('pool-debug-id');
        if (debugIdEl) debugIdEl.textContent = `Pool ID: ${pool.pool_id || '-'}`;

        // Pool physical properties from pool data
        const areaEl = document.getElementById('pool-area');
        const volumeEl = document.getElementById('pool-volume');
        const depthEl = document.getElementById('pool-depth');

        if (areaEl) areaEl.textContent = pool.area ? `${pool.area} m²` : '- m²';
        if (volumeEl) volumeEl.textContent = pool.volume ? `${pool.volume} m³` : '- m³';
        if (depthEl) depthEl.textContent = pool.depth ? `${pool.depth} m` : '- m';

        // Equipment from configuration
        const targetEl = document.getElementById('pool-target-temp');
        const hpEl = document.getElementById('pool-hp-capacity');
        const boilerEl = document.getElementById('pool-boiler-capacity');

        if (cfg) {
            if (targetEl) targetEl.textContent = cfg.control?.target_temp ? `${cfg.control.target_temp}°C` : '28°C';
            if (hpEl) hpEl.textContent = cfg.equipment?.hp_capacity_kw ? `${cfg.equipment.hp_capacity_kw} kW` : '- kW';
            if (boilerEl) boilerEl.textContent = cfg.equipment?.boiler_capacity_kw ? `${cfg.equipment.boiler_capacity_kw} kW` : '- kW';
        }
    },

    // Update project name and description display
    updateDisplay() {
        const nameEl = document.getElementById('project-display-name');
        const descEl = document.getElementById('project-display-desc');
        const debugEl = document.getElementById('project-debug-ids');

        if (nameEl) {
            nameEl.textContent = this.currentProject?.name || 'Unnamed Project';
        }
        if (descEl) {
            descEl.textContent = this.currentProject?.description || 'Click to add description...';
        }
        if (debugEl) {
            const siteId = this.currentSite?.id || '-';
            const poolId = this.currentPool?.pool_id || '-';
            debugEl.textContent = `Project: ${this.currentProject?.id || '-'} | Site: ${siteId} | Pool: ${poolId}`;
        }

        // Also update header (show project ID for debugging)
        const headerProject = document.getElementById('current-project');
        if (headerProject) {
            const pId = this.currentProject?.id || '';
            const pName = this.currentProject?.name || 'Project';
            headerProject.textContent = pId ? `[${pId}] ${pName}` : pName;
        }
    },

    // Load project summary data
    async loadSummary() {
        try {
            // Get configuration data
            if (typeof app.configuration !== 'undefined') {
                const config = app.configuration.getConfig();
                if (config) {
                    const siteEl = document.getElementById('dash-site-name');
                    const areaEl = document.getElementById('dash-pool-area');
                    const hpEl = document.getElementById('dash-hp-capacity');
                    const boilerEl = document.getElementById('dash-boiler-capacity');

                    if (siteEl) siteEl.textContent = this.currentProject?.name || '-';
                    if (areaEl) areaEl.textContent = config.pool?.surface_area ? `${config.pool.surface_area} m²` : '-';
                    if (hpEl) hpEl.textContent = config.equipment?.hp_capacity_kw ? `${config.equipment.hp_capacity_kw} kW` : '-';
                    if (boilerEl) boilerEl.textContent = config.equipment?.boiler_capacity_kw ? `${config.equipment.boiler_capacity_kw} kW` : '-';
                }
            }

            // Get weather data range (from simulation API)
            const weatherResponse = await fetch('./api/simulation_api.php?action=get_weather_range');
            if (weatherResponse.ok) {
                const weatherData = await weatherResponse.json();
                const rangeEl = document.getElementById('dash-weather-range');
                const countEl = document.getElementById('dash-weather-count');

                if (rangeEl && weatherData.min_date && weatherData.max_date) {
                    rangeEl.textContent = `${weatherData.min_date} to ${weatherData.max_date}`;
                }
                if (countEl && weatherData.count) {
                    countEl.textContent = weatherData.count.toLocaleString();
                }
            }

            // Get recent simulations
            await this.loadRecentSimulations();
        } catch (error) {
            console.error('Error loading project summary:', error);
        }
    },

    // Load recent simulation runs
    async loadRecentSimulations() {
        try {
            const response = await fetch(`./api/simulation_api.php?action=get_runs&limit=3`);
            if (response.ok) {
                const data = await response.json();
                const runs = data.runs || [];
                const container = document.getElementById('dash-recent-runs');

                if (container && runs.length > 0) {
                    // Show last 3 runs
                    const recentRuns = runs.slice(0, 3);
                    container.innerHTML = recentRuns.map(run => {
                        const date = new Date(run.created_at).toLocaleDateString();
                        return `<div style="padding: 5px 0; border-bottom: 1px solid #eee;">
                            <strong>${run.scenario_name || 'Run #' + run.id}</strong>
                            <span style="color: #666; font-size: 12px; margin-left: 10px;">${date}</span>
                        </div>`;
                    }).join('');
                } else if (container) {
                    container.innerHTML = '<span class="text-muted">No simulations yet</span>';
                }
            }
        } catch (error) {
            console.error('Error loading recent simulations:', error);
        }
    },

    // Load list of available projects into dropdown
    async loadProjectsList() {
        try {
            console.log('[Project] Fetching projects list...');
            const response = await fetch(`${config.API_BASE_URL}?action=get_projects`);
            console.log('[Project] get_projects response status:', response.status);
            const dropdown = document.getElementById('projects-dropdown');
            console.log('[Project] projects-dropdown found:', !!dropdown);

            if (response.ok) {
                const data = await response.json();
                console.log('[Project] get_projects data:', data);
                this.projects = data.projects || [];
                console.log('[Project] Parsed projects array:', this.projects.length, 'projects');

                if (dropdown && Array.isArray(this.projects) && this.projects.length > 0) {
                    dropdown.innerHTML = this.projects.map(project => {
                        const projectId = project.project_id || project.id;
                        const projectName = project.project_name || project.name;
                        const isActive = projectId == this.currentProject?.id;
                        const desc = project.description ? ` - ${project.description}` : '';
                        return `<option value="${projectId}" ${isActive ? 'selected' : ''}>${projectName || 'Unnamed Project'}${desc}</option>`;
                    }).join('');
                } else if (dropdown) {
                    dropdown.innerHTML = `<option value="${this.currentProject?.id || ''}" selected>${this.currentProject?.name || 'Default Project'}</option>`;
                }
            } else if (dropdown) {
                dropdown.innerHTML = `<option value="${this.currentProject?.id || ''}" selected>${this.currentProject?.name || 'Default Project'}</option>`;
            }
        } catch (error) {
            console.error('Error loading projects list:', error);
            const dropdown = document.getElementById('projects-dropdown');
            if (dropdown) {
                dropdown.innerHTML = `<option value="${this.currentProject?.id || ''}" selected>${this.currentProject?.name || 'Default Project'}</option>`;
            }
        }
    },

    // Edit project name
    editName() {
        const displayEl = document.getElementById('project-display-name');
        const formEl = document.getElementById('project-edit-name-form');
        const inputEl = document.getElementById('project-name-input');

        if (inputEl) {
            inputEl.value = this.currentProject?.name || '';
        }
        if (formEl) {
            formEl.style.display = 'block';
        }
        if (inputEl) {
            inputEl.focus();
        }
    },

    // Cancel name edit
    cancelEditName() {
        const formEl = document.getElementById('project-edit-name-form');
        if (formEl) {
            formEl.style.display = 'none';
        }
    },

    // Save project name
    async saveName() {
        const inputEl = document.getElementById('project-name-input');
        const newName = inputEl?.value?.trim();

        if (!newName) {
            alert('Please enter a project name');
            return;
        }

        try {
            // Update in backend (if API supports it)
            const response = await fetch(`${config.API_BASE_URL}?action=update_project`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: this.currentProject?.id,
                    name: newName
                })
            });

            // Update locally regardless of backend support
            this.currentProject.name = newName;
            localStorage.setItem('heataq_project_name', newName);

            // Update display
            this.updateDisplay();
            this.cancelEditName();

            console.log('Project name updated:', newName);
        } catch (error) {
            console.error('Error saving project name:', error);
            // Still update locally
            this.currentProject.name = newName;
            localStorage.setItem('heataq_project_name', newName);
            this.updateDisplay();
            this.cancelEditName();
        }
    },

    // Edit project description
    editDescription() {
        const formEl = document.getElementById('project-edit-desc-form');
        const inputEl = document.getElementById('project-desc-input');

        if (inputEl) {
            inputEl.value = this.currentProject?.description || '';
        }
        if (formEl) {
            formEl.style.display = 'block';
        }
        if (inputEl) {
            inputEl.focus();
        }
    },

    // Cancel description edit
    cancelEditDescription() {
        const formEl = document.getElementById('project-edit-desc-form');
        if (formEl) {
            formEl.style.display = 'none';
        }
    },

    // Save project description
    async saveDescription() {
        const inputEl = document.getElementById('project-desc-input');
        const newDesc = inputEl?.value?.trim() || '';

        try {
            // Update in backend (if API supports it)
            const response = await fetch(`${config.API_BASE_URL}?action=update_project`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: this.currentProject?.id,
                    description: newDesc
                })
            });

            // Update locally regardless of backend support
            this.currentProject.description = newDesc;
            localStorage.setItem('heataq_project_desc', newDesc);

            // Update display
            this.updateDisplay();
            this.cancelEditDescription();

            console.log('Project description updated');
        } catch (error) {
            console.error('Error saving project description:', error);
            // Still update locally
            this.currentProject.description = newDesc;
            localStorage.setItem('heataq_project_desc', newDesc);
            this.updateDisplay();
            this.cancelEditDescription();
        }
    },

    // Show new project modal
    async showNewProjectModal() {
        const modal = document.getElementById('new-project-modal');
        if (modal) {
            modal.style.display = 'flex';
            const nameInput = document.getElementById('new-project-name');
            if (nameInput) {
                nameInput.value = '';
                nameInput.focus();
            }
            const descInput = document.getElementById('new-project-desc');
            if (descInput) {
                descInput.value = '';
            }
            // Reset site option to default
            const siteOption = document.getElementById('new-project-site-option');
            if (siteOption) {
                siteOption.value = 'default';
            }
            // Hide source site dropdown
            const sourceContainer = document.getElementById('new-project-source-site-container');
            if (sourceContainer) {
                sourceContainer.style.display = 'none';
            }
            // Load available sites for copy option
            await this.loadAvailableSites();
        }
    },

    // Load available sites for the copy dropdown
    async loadAvailableSites() {
        try {
            const response = await fetch(`${config.API_BASE_URL}?action=get_sites`);
            if (response.ok) {
                const data = await response.json();
                const sites = data.sites || [];
                const select = document.getElementById('new-project-source-site');
                if (select) {
                    if (sites.length > 0) {
                        select.innerHTML = sites.map(site =>
                            `<option value="${site.id}">${site.name} (${site.pool_count || 0} pools)</option>`
                        ).join('');
                    } else {
                        select.innerHTML = '<option value="">No existing sites available</option>';
                    }
                }
            }
        } catch (error) {
            console.error('Error loading sites:', error);
        }
    },

    // Handle site option change
    onSiteOptionChange() {
        const siteOption = document.getElementById('new-project-site-option')?.value;
        const sourceContainer = document.getElementById('new-project-source-site-container');
        if (sourceContainer) {
            sourceContainer.style.display = siteOption === 'copy' ? 'block' : 'none';
        }
    },

    // Hide new project modal
    hideNewProjectModal() {
        const modal = document.getElementById('new-project-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    // Create new project
    async createNewProject() {
        const nameInput = document.getElementById('new-project-name');
        const descInput = document.getElementById('new-project-desc');
        const siteOptionSelect = document.getElementById('new-project-site-option');
        const sourceSiteSelect = document.getElementById('new-project-source-site');

        const name = nameInput?.value?.trim();
        const description = descInput?.value?.trim() || '';
        const siteOption = siteOptionSelect?.value || 'default';
        const sourcePoolSiteId = siteOption === 'copy' ? sourceSiteSelect?.value : null;

        if (!name) {
            alert('Please enter a project name');
            return;
        }

        // Build request body
        const requestBody = {
            name,
            description,
            create_default_site: siteOption === 'default',
            source_pool_site_id: sourcePoolSiteId ? parseInt(sourcePoolSiteId) : null
        };

        try {
            // Create in backend
            const response = await fetch(`${config.API_BASE_URL}?action=create_project`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                const newProject = await response.json();

                // Switch to new project
                if (newProject.id) {
                    localStorage.setItem('heataq_project', newProject.id);
                    document.cookie = `heataq_project=${newProject.id}; path=/; max-age=31536000`;
                }
                localStorage.setItem('heataq_project_name', name);
                localStorage.setItem('heataq_project_desc', description);

                this.currentProject = {
                    id: newProject.id,
                    name: name,
                    description: description
                };

                // New project has its own (empty) schedules — force the
                // Schedules section to reload rather than show the old project's.
                window.schedulesLoaded = false;

                // Refresh display
                this.hideNewProjectModal();
                await this.load();

                console.log('New project created:', name);
            } else {
                // Backend might not support project creation yet
                // Create locally only
                const localId = 'local_' + Date.now();
                localStorage.setItem('heataq_project', localId);
                localStorage.setItem('heataq_project_name', name);
                localStorage.setItem('heataq_project_desc', description);
                document.cookie = `heataq_project=${localId}; path=/; max-age=31536000`;

                this.currentProject = {
                    id: localId,
                    name: name,
                    description: description
                };

                this.hideNewProjectModal();
                this.updateDisplay();
                this.loadProjectsList();

                console.log('New project created locally:', name);
            }
        } catch (error) {
            console.error('Error creating project:', error);
            // Create locally as fallback
            const localId = 'local_' + Date.now();
            localStorage.setItem('heataq_project', localId);
            localStorage.setItem('heataq_project_name', name);
            localStorage.setItem('heataq_project_desc', description);
            document.cookie = `heataq_project=${localId}; path=/; max-age=31536000`;

            this.currentProject = {
                id: localId,
                name: name,
                description: description
            };

            this.hideNewProjectModal();
            this.updateDisplay();
            this.loadProjectsList();
        }
    },

    // Switch to a different project
    async switchProject(projectId) {
        if (projectId == this.currentProject?.id) {
            return; // Already on this project
        }

        try {
            // Find project in list (API returns project_id and project_name)
            const project = this.projects.find(p => (p.project_id || p.id) == projectId);

            if (project) {
                const pId = project.project_id || project.id;
                const pName = project.project_name || project.name;

                // Clear old project's site/pool data from localStorage
                localStorage.removeItem('heataq_site');
                localStorage.removeItem('heataq_pool');
                localStorage.removeItem('heataq_pool_site_id');

                // Clear the pool_site_id cookie (used by API)
                document.cookie = 'heataq_pool_site_id=; path=/; max-age=0';

                // Set new project in localStorage AND cookie (API reads cookie)
                localStorage.setItem('heataq_project', pId);
                localStorage.setItem('heataq_project_name', pName);
                localStorage.setItem('heataq_project_desc', project.description || '');
                document.cookie = `heataq_project=${pId}; path=/; max-age=31536000`;

                this.currentProject = {
                    id: pId,
                    name: pName,
                    description: project.description
                };

                // Persist the switch on the server session BEFORE reloading
                // data. The backend derives the current project from the
                // session (not the cookie) in production, so this must complete
                // first or the reloads below read the previous project.
                try {
                    await fetch(`${config.API_BASE_URL}?action=switch_project`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ project_id: pId })
                    });
                } catch (e) {
                    console.error('[Project] switch_project failed:', e);
                }

                // Clear current site/pool (will be reloaded from API)
                this.currentSite = null;
                this.currentPool = null;
                this.currentPoolId = null;

                // Update project display
                this.updateDisplay();

                // Reload site data from API (for new project)
                await this.loadSiteData();

                // Reload pool data
                await this.loadPoolData();

                // Update pool card
                await this.updatePoolCard();

                // Reload configurations for new project
                if (typeof app !== 'undefined' && app.configuration) {
                    app.configuration.currentConfigId = null; // Clear current selection
                    await app.configuration.loadConfigs();
                }

                // Force the Schedules section to reload for the new project.
                // It is gated by a one-time window.schedulesLoaded flag and is
                // otherwise never refreshed on a project switch, so it would keep
                // showing (and editing against) the previous project's templates,
                // day/week schedules and calendar until a full page reload.
                window.schedulesLoaded = false;

                // Update projects dropdown to show new selection
                await this.loadProjectsList();

                // Stay on project page (ensure we're there)
                if (typeof navigation !== 'undefined') {
                    navigation.switchSection('project', true);
                }

                console.log('[Project] Switched to project:', pName);
            }
        } catch (error) {
            console.error('Error switching project:', error);
        }
    }
};

// Export for global use
window.ProjectModule = ProjectModule;
