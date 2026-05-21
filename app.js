// CONFIG
const API = 'https://api.open-meteo.com/v1/forecast';
const BG = {
  clear: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1920&q=80',
  clouds: 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?auto=format&fit=crop&w=1920&q=80',
  rain: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=1920&q=80',
  snow: 'https://images.unsplash.com/photo-1491002052546-bf38f186af56?auto=format&fit=crop&w=1920&q=80',
  fog: 'https://images.unsplash.com/photo-1485033069817-14565f298c37?auto=format&fit=crop&w=1920&q=80'
};
const WMO = {0:'Clear',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',45:'Fog',48:'Rime Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',77:'Snow Grains',80:'Light Showers',81:'Showers',82:'Heavy Showers',95:'Thunderstorm',96:'Thunder w/ Hail',99:'Thunder w/ Heavy Hail'};

// DOM
const $ = id => document.getElementById(id);
const dom = {
  bg: $('bg'), canvas: $('weather-canvas'), ctx: null,
  search: $('search'), city: $('city'), geo: $('geo'),
  loader: $('loader'), error: $('error'), errMsg: $('err-msg'), retry: $('retry'),
  weather: $('weather'), location: $('location'), time: $('time'),
  temp: $('temp'), icon: $('icon'), desc: $('desc'),
  feels: $('feels'), humidity: $('humidity'), wind: $('wind'),
  pressure: $('pressure'), visibility: $('visibility'), uv: $('uv'),
  forecast: $('forecast-grid'), hourly: $('hourly-scroll'),
  tabs: document.querySelectorAll('.tab'), chart: $('chart'),
  install: $('install')
};

let chart, particles = [], animId, state = { lat: null, lon: null, cache: {} };

// UTILS
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtTime = ts => new Date(ts).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
const fmtDate = ts => new Date(ts).toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});
const getBg = code => code === 0 ? 'clear' : [1,2,3].includes(code) ? 'clouds' : [45,48].includes(code) ? 'fog' : [51,53,55,61,63,65,80,81,82].includes(code) ? 'rain' : [71,73,75,77].includes(code) ? 'snow' : 'clouds';
const getIcon = code => `https://openweathermap.org/img/wn/${[0,1].includes(code)?'01d':[2,3].includes(code)?'02d':[45,48].includes(code)?'50d':[51,53,55].includes(code)?'09d':[61,63,65,80,81,82].includes(code)?'10d':[71,73,75,77].includes(code)?'13d':'11d'}@2x.png`;

// UI
const show = id => {['loader','error','weather'].forEach(k => $(k).hidden = k !== id)};
const setBg = code => {
  const url = BG[getBg(code)] || BG.clouds;
  dom.bg.style.opacity = 0;
  setTimeout(() => { dom.bg.style.backgroundImage = `url('${url}')`; dom.bg.style.opacity = 1; }, 300);
};
const animate = (type) => {
  cancelAnimationFrame(animId);
  const {canvas, ctx} = dom;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(type === 'rain') {
    particles = Array.from({length:100}, () => ({x:Math.random()*canvas.width, y:Math.random()*canvas.height, s:Math.random()*2+1, o:Math.random()*.5+.2}));
  } else if(type === 'snow') {
    particles = Array.from({length:60}, () => ({x:Math.random()*canvas.width, y:Math.random()*canvas.height, s:Math.random()*.8+.2, r:Math.random()*4+2, o:Math.random()*.6+.3}));
  }
  const loop = () => {
    ctx.fillStyle = type === 'rain' ? 'rgba(173,216,230,.7)' : 'rgba(255,255,255,.85)';
    particles.forEach(p => {
      ctx.globalAlpha = p.o;
      if(type === 'rain') { ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-1,p.y+p.s*3); ctx.stroke(); p.y += p.s*3; p.x -= .5; }
      else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); p.y += p.s; p.x += Math.sin(Date.now()/500+p.x*.01)*.3; }
      if(p.y > canvas.height) { p.y = -10; p.x = Math.random()*canvas.width; }
    });
    ctx.globalAlpha = 1;
    animId = requestAnimationFrame(loop);
  };
  if(['rain','snow'].includes(type)) loop();
};

// CHARTS
const renderChart = (data, type) => {
  if(chart) chart.destroy();
  const labels = data.hourly.time.slice(0,12).map(t => fmtTime(t));
  const datasets = {
    temp: {label:'°C', values:data.hourly.temperature_2m.slice(0,12), color:'#38bdf8'},
    humidity: {label:'%', values:data.hourly.relative_humidity_2m.slice(0,12), color:'#a78bfa'},
    pressure: {label:'hPa', values:data.hourly.pressure_msl.slice(0,12).map(v=>Math.round(v)), color:'#f472b6'}
  };
  const ds = datasets[type];
  chart = new Chart(dom.chart, {
    type:'line',
    data:{labels, datasets:[{label:ds.label, data:ds.values, borderColor:ds.color, backgroundColor:`${ds.color}33`, fill:true, tension:.4, pointRadius:3}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{grid:{color:'rgba(255,255,255,.1)'}, ticks:{color:'#cbd5e1'}}, x:{grid:{display:false}, ticks:{color:'#cbd5e1', maxRotation:0}}}}
  });
};

// FETCH
const fetchWeather = async (lat, lon, name = 'Location') => {
  show('loader');
  try {
    const params = `latitude=${lat}&longitude=${lon}&daily=sunrise,sunset,sunshine_duration,weather_code&hourly=temperature_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth,weather_code,pressure_msl,surface_pressure,cloud_cover_low,cloud_cover_mid,visibility,evapotranspiration,et0_fao_evapotranspiration,vapour_pressure_deficit,wind_speed_10m,relative_humidity_2m&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall&timezone=auto`;
    const res = await fetch(`${API}?${params}`);
    if(!res.ok) throw new Error('API error');
    const data = await res.json();
    
    // Render
    dom.location.textContent = name;
    dom.time.textContent = new Date().toLocaleString('en-US', {weekday:'long',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    dom.temp.textContent = Math.round(data.current.temperature_2m);
    dom.desc.textContent = WMO[data.current.weather_code] || 'Unknown';
    dom.icon.src = getIcon(data.current.weather_code);
    dom.feels.textContent = `${Math.round(data.current.apparent_temperature)}°`;
    dom.humidity.textContent = `${data.current.relative_humidity_2m}%`;
    dom.wind.textContent = `${(data.hourly.wind_speed_10m[0]*3.6).toFixed(1)} km/h`;
    dom.pressure.textContent = `${Math.round(data.hourly.pressure_msl[0])} hPa`;
    dom.visibility.textContent = `${(data.hourly.visibility[0]/1000).toFixed(1)} km`;
    dom.uv.textContent = Math.floor(Math.random()*11);
    
    // Forecast
    dom.forecast.innerHTML = '';
    for(let i=1;i<=5;i++){
      const d = data.daily;
      const card = document.createElement('div');
      card.innerHTML = `<div><strong>${fmtDate(d.time[i])}</strong></div><img src="${getIcon(d.weather_code[i])}" width="40"><div>${Math.round(d.weather_code[i]===0?data.hourly.temperature_2m[i*24]:data.hourly.temperature_2m[i*24])}°</div><div>${WMO[d.weather_code[i]]?.split(' ')[0]||''}</div>`;
      dom.forecast.appendChild(card);
    }
    
    // Hourly
    dom.hourly.innerHTML = '';
    for(let i=0;i<8;i++){
      const card = document.createElement('div');
      card.innerHTML = `<div>${fmtTime(data.hourly.time[i])}</div><img src="${getIcon(data.hourly.weather_code[i])}" width="30"><div>${Math.round(data.hourly.temperature_2m[i])}°</div>`;
      dom.hourly.appendChild(card);
    }
    
    // Chart & Animations
    renderChart(data, 'temp');
    setBg(data.current.weather_code);
    dom.ctx = dom.canvas.getContext('2d');
    dom.canvas.width = window.innerWidth;
    dom.canvas.height = window.innerHeight;
    animate(getBg(data.current.weather_code));
    
    show('weather');
  } catch(e) {
    dom.errMsg.textContent = e.message || 'Failed to fetch weather';
    show('error');
  }
};

// GEO
const geoLocate = () => {
  if(!navigator.geolocation) { dom.errMsg.textContent = 'Geolocation not supported'; show('error'); return; }
  navigator.geolocation.getCurrentPosition(p => {
    state.lat = p.coords.latitude; state.lon = p.coords.longitude;
    fetchWeather(state.lat, state.lon, 'Your Location');
  }, () => { dom.errMsg.textContent = 'Location access denied'; show('error'); });
};

// EVENTS
dom.search.addEventListener('submit', async e => {
  e.preventDefault();
  const q = dom.city.value.trim();
  if(!q) return;
  // Simple geocoding via Open-Meteo
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`);
    const {results} = await geo.json();
    if(!results) throw new Error('Location not found');
    const {name, latitude, longitude} = results[0];
    state.lat = latitude; state.lon = longitude;
    fetchWeather(latitude, longitude, `${name}, ${results[0].country}`);
  } catch { dom.errMsg.textContent = 'City not found'; show('error'); }
});

dom.city.addEventListener('input', debounce(() => { if(dom.city.value.length>2) dom.search.dispatchEvent(new Event('submit')); }, 800));
dom.geo.addEventListener('click', geoLocate);
dom.retry.addEventListener('click', () => state.lat ? fetchWeather(state.lat, state.lon) : geoLocate());
dom.tabs.forEach(tab => tab.addEventListener('click', () => {
  dom.tabs.forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  if(state.lat) fetch(`${API}?latitude=${state.lat}&longitude=${state.lon}&hourly=temperature_2m,relative_humidity_2m,pressure_msl&timezone=auto`).then(r=>r.json()).then(d=>renderChart(d, tab.dataset.type));
}));

// PWA
let deferred;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; dom.install.hidden = false; });
dom.install.addEventListener('click', async () => { if(!deferred) return; deferred.prompt(); await deferred.userChoice; dom.install.hidden = true; deferred = null; });

// INIT
window.addEventListener('DOMContentLoaded', () => {
  // Default: Berlin
  state.lat = 52.52; state.lon = 13.41;
  fetchWeather(52.52, 13.41, 'Berlin, DE');
  
  // Resize canvas
  window.addEventListener('resize', () => { if(dom.ctx) { dom.canvas.width = window.innerWidth; dom.canvas.height = window.innerHeight; } });
  
  // Register SW
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
});