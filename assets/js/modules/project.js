// Project Management Module

const ProjectModule = {
    currentProject: null,
    projects: [],
    currentSite: null,
    weatherStations: [],

    // Load project data
    async load() {
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

            // Update display
            this.updateDisplay();

            // Load site data
            await this.loadSiteData();

            // Load pool data
            this.loadPoolData();

            // Load project summary
            await this.loadSummary();

            // Update pool card
            this.updatePoolCard();

            // Load projects list
            await this.loadProjectsList();
        } catch (error) {
            console.error('Error loading project:', error);
        }
    },

    // Load site data from localStorage or API
    async loadSiteData() {
        try {
            // Load from localStorage
            const siteData = localStorage.getItem('heataq_site');
            if (siteData) {
                this.currentSite = JSON.parse(siteData);
            } else {
                // Default site
                this.currentSite = {
                    name: 'Main Site',
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

        // Update name
        const nameEl = document.getElementById('site-name');
        if (nameEl) nameEl.textContent = site.name || 'Main Site';

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

        modal.style.display = 'flex';
    },

    // Update solar data status display
    updateSolarStatus() {
        const statusEl = document.getElementById('solar-fetch-status');
        const lastUpdatedEl = document.getElementById('solar-last-updated');
        const site = this.currentSite || {};

        if (statusEl) {
            if (site.solar_last_fetched) {
                statusEl.textContent = `✓ Solar data loaded (${site.solar_days || '?'} days)`;
                statusEl.style.color = '#28a745';
            } else {
                statusEl.textContent = 'Not fetched - click to load 10 years of hourly solar radiation data';
                statusEl.style.color = '#666';
            }
        }

        if (lastUpdatedEl) {
            if (site.solar_last_fetched) {
                const date = new Date(site.solar_last_fetched);
                lastUpdatedEl.textContent = `Last updated: ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
            } else {
                lastUpdatedEl.textContent = '';
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

        const name = nameEl?.value?.trim() || '';
        const latRaw = latEl?.value;
        const lngRaw = lngEl?.value;
        const lat = latRaw ? parseFloat(latRaw) : null;
        const lng = lngRaw ? parseFloat(lngRaw) : null;
        const wsId = wsEl?.value || null;

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

        // Update site
        this.currentSite = {
            ...this.currentSite,
            name: name || 'Main Site',
            latitude: lat,
            longitude: lng,
            weather_station_id: wsId,
            weather_station_name: wsName
        };

        // Save to localStorage
        localStorage.setItem('heataq_site', JSON.stringify(this.currentSite));

        // Update display
        this.updateSiteDisplay();
        this.hideSiteModal();

        console.log('[Project] Site saved:', this.currentSite);

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

    // Show add site modal (placeholder)
    showAddSiteModal() {
        alert('Multi-site support coming soon. Currently only one site per project is supported.');
    },

    // Show add pool modal (placeholder)
    showAddPoolModal() {
        alert('Multi-pool support coming soon. Use Edit Pool to configure the main pool.');
    },

    // Current pool data
    currentPool: null,

    // Load pool data
    loadPoolData() {
        const poolData = localStorage.getItem('heataq_pool');
        if (poolData) {
            this.currentPool = JSON.parse(poolData);
        } else {
            // Default pool matching benchmark
            this.currentPool = {
                name: 'Main Pool',
                length: 25,
                width: 12.5,
                depth: 2.0,
                area: 312.5,
                volume: 625,
                wind_exposure: 0.535,
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
    editPool() {
        const modal = document.getElementById('edit-pool-modal');
        if (!modal) return;

        // Load pool data if not loaded
        if (!this.currentPool) {
            this.loadPoolData();
        }

        const pool = this.currentPool;

        // Populate form
        document.getElementById('edit-pool-name').value = pool.name || 'Main Pool';
        document.getElementById('edit-pool-length').value = pool.length || '';
        document.getElementById('edit-pool-width').value = pool.width || '';
        document.getElementById('edit-pool-depth').value = pool.depth || '';
        document.getElementById('edit-pool-wind').value = pool.wind_exposure ?? 0.535;
        document.getElementById('edit-pool-solar').value = pool.solar_absorption ?? 60;
        document.getElementById('edit-pool-has-cover').value = pool.has_cover ? '1' : '0';
        document.getElementById('edit-pool-cover-u').value = pool.cover_u_value ?? 5.0;
        document.getElementById('edit-pool-cover-solar').value = pool.cover_solar_trans ?? 10;
        document.getElementById('edit-pool-has-tunnel').value = pool.has_tunnel ? '1' : '0';
        document.getElementById('edit-pool-floor-insulated').value = pool.floor_insulated ? '1' : '0';

        // Calculate and show dimensions
        this.calcPoolDimensions();
        this.togglePoolCover();

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

    // Save pool
    savePool() {
        const length = parseFloat(document.getElementById('edit-pool-length')?.value) || 0;
        const width = parseFloat(document.getElementById('edit-pool-width')?.value) || 0;
        const depth = parseFloat(document.getElementById('edit-pool-depth')?.value) || 0;

        this.currentPool = {
            name: document.getElementById('edit-pool-name')?.value?.trim() || 'Main Pool',
            length: length,
            width: width,
            depth: depth,
            area: length * width,
            volume: length * width * depth,
            wind_exposure: parseFloat(document.getElementById('edit-pool-wind')?.value) || 0.535,
            solar_absorption: parseFloat(document.getElementById('edit-pool-solar')?.value) || 60,
            has_cover: document.getElementById('edit-pool-has-cover')?.value === '1',
            cover_u_value: parseFloat(document.getElementById('edit-pool-cover-u')?.value) || 5.0,
            cover_solar_trans: parseFloat(document.getElementById('edit-pool-cover-solar')?.value) || 10,
            has_tunnel: document.getElementById('edit-pool-has-tunnel')?.value === '1',
            floor_insulated: document.getElementById('edit-pool-floor-insulated')?.value === '1'
        };

        // Save to localStorage
        localStorage.setItem('heataq_pool', JSON.stringify(this.currentPool));

        // Update displays
        this.updatePoolCard();
        this.hidePoolModal();

        console.log('[Project] Pool saved:', this.currentPool);
    },

    // Update pool card display
    updatePoolCard() {
        // Load pool data if not loaded
        if (!this.currentPool) {
            this.loadPoolData();
        }

        const pool = this.currentPool;
        const cfg = typeof app.configuration !== 'undefined' ? app.configuration.getConfig() : null;

        // Pool name
        const nameEl = document.getElementById('pool-name');
        if (nameEl) nameEl.textContent = pool.name || 'Main Pool';

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

        if (nameEl) {
            nameEl.textContent = this.currentProject?.name || 'Unnamed Project';
        }
        if (descEl) {
            descEl.textContent = this.currentProject?.description || 'Click to add description...';
        }

        // Also update header
        const headerProject = document.getElementById('current-project');
        if (headerProject) {
            headerProject.textContent = this.currentProject?.name || 'Project';
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

            // Get weather data range
            const weatherResponse = await fetch(`${config.API_BASE_URL}?action=get_weather_range`);
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

    // Load list of available projects
    async loadProjectsList() {
        try {
            const response = await fetch(`${config.API_BASE_URL}?action=get_projects`);
            const container = document.getElementById('projects-list');

            if (response.ok) {
                this.projects = await response.json();

                if (container && Array.isArray(this.projects) && this.projects.length > 0) {
                    container.innerHTML = this.projects.map(project => {
                        const isActive = project.id == this.currentProject?.id;
                        return `<div class="project-item" style="padding: 10px; border: 1px solid ${isActive ? '#0d6efd' : '#dee2e6'}; border-radius: 6px; margin-bottom: 8px; background: ${isActive ? '#e7f1ff' : '#fff'}; cursor: pointer;" onclick="app.project.switchProject(${project.id})">
                            <strong>${project.name || 'Unnamed Project'}</strong>
                            ${isActive ? '<span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>' : ''}
                            <p style="margin: 5px 0 0; font-size: 12px; color: #666;">${project.description || 'No description'}</p>
                        </div>`;
                    }).join('');
                } else if (container) {
                    container.innerHTML = `<div class="project-item" style="padding: 10px; border: 1px solid #0d6efd; border-radius: 6px; background: #e7f1ff;">
                        <strong>${this.currentProject?.name || 'Default Project'}</strong>
                        <span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>
                        <p style="margin: 5px 0 0; font-size: 12px; color: #666;">${this.currentProject?.description || 'No description'}</p>
                    </div>`;
                }
            } else if (container) {
                // API might not have getProjects yet - show current project only
                container.innerHTML = `<div class="project-item" style="padding: 10px; border: 1px solid #0d6efd; border-radius: 6px; background: #e7f1ff;">
                    <strong>${this.currentProject?.name || 'Default Project'}</strong>
                    <span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>
                    <p style="margin: 5px 0 0; font-size: 12px; color: #666;">${this.currentProject?.description || 'No description'}</p>
                </div>`;
            }
        } catch (error) {
            console.error('Error loading projects list:', error);
            // Show current project as fallback
            const container = document.getElementById('projects-list');
            if (container) {
                container.innerHTML = `<div class="project-item" style="padding: 10px; border: 1px solid #0d6efd; border-radius: 6px; background: #e7f1ff;">
                    <strong>${this.currentProject?.name || 'Default Project'}</strong>
                    <span style="float: right; color: #0d6efd; font-size: 12px;">Current</span>
                </div>`;
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
    showNewProjectModal() {
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

        const name = nameInput?.value?.trim();
        const description = descInput?.value?.trim() || '';

        if (!name) {
            alert('Please enter a project name');
            return;
        }

        try {
            // Create in backend
            const response = await fetch(`${config.API_BASE_URL}?action=create_project`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });

            if (response.ok) {
                const newProject = await response.json();

                // Switch to new project
                if (newProject.id) {
                    localStorage.setItem('heataq_project', newProject.id);
                }
                localStorage.setItem('heataq_project_name', name);
                localStorage.setItem('heataq_project_desc', description);

                this.currentProject = {
                    id: newProject.id,
                    name: name,
                    description: description
                };

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
            // Find project in list
            const project = this.projects.find(p => p.id == projectId);

            if (project) {
                localStorage.setItem('heataq_project', project.id);
                localStorage.setItem('heataq_project_name', project.name);
                localStorage.setItem('heataq_project_desc', project.description || '');

                this.currentProject = {
                    id: project.id,
                    name: project.name,
                    description: project.description
                };

                // Refresh page to load new project data
                window.location.reload();
            }
        } catch (error) {
            console.error('Error switching project:', error);
        }
    }
};

// Export for global use
window.ProjectModule = ProjectModule;
