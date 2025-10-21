// Variables to hold parsed CSV and aggregated data
let csvData = null;
let aggregated = [];
let populationData = null;
// global maximum total medals across all years/seasons/countries (used to keep legend range fixed)
let globalMaxTotal = 0;
// quantile breaks (threshold domains) and color range for binned legend
let globalBreaks = [];
let colorRange = [];

// load CSV once and populate controls
Papa.parse('./data/olympic_games.csv', {
  header: true,
  download: true,
  dynamicTyping: true,
  complete: function(results) {
    csvData = results.data;
    computeGlobalMaxTotal();
    computeGlobalQuantileBreaks(6); // default to 6 classes
    populateFilters(csvData);
    // Load population data before first render (needed for per-capita chart)
    Papa.parse('./data/population.csv', {
      header: true,
      download: true,
      dynamicTyping: true,
      complete: function(popRes) {
        populationData = popRes.data;
        updateAndRender();
      },
      error: function(err) {
        console.warn('Failed to load population.csv:', err);
        updateAndRender(); // Render without per-capita if population missing
      }
    });
  }
});

// Compute global maximum total medals across (year, season, country) groups
function computeGlobalMaxTotal() {
  if (!csvData) { globalMaxTotal = 0; return; }
  const map = new Map();
  csvData.forEach(r => {
    const y = r.year;
    const s = r.games_type;
    const c = r.country;
    const gold = Number(r.gold) || 0;
    const silver = Number(r.silver) || 0;
    const bronze = Number(r.bronze) || 0;
    const total = gold + silver + bronze;
    const key = `${y}::${s}::${c}`;
    if (!map.has(key)) map.set(key, 0);
    map.set(key, map.get(key) + total);
  });
  let max = 0;
  for (const v of map.values()) if (v > max) max = v;
  globalMaxTotal = max;
}

// Compute global quantile breaks for threshold binning
function computeGlobalQuantileBreaks(numClasses) {
  globalBreaks = [];
  colorRange = [];
  if (!csvData || numClasses < 2) return;
  // build totals for each (year,season,country)
  const map = new Map();
  csvData.forEach(r => {
    const y = r.year;
    const s = r.games_type;
    const c = r.country;
    const gold = Number(r.gold) || 0;
    const silver = Number(r.silver) || 0;
    const bronze = Number(r.bronze) || 0;
    const total = gold + silver + bronze;
    const key = `${y}::${s}::${c}`;
    if (!map.has(key)) map.set(key, 0);
    map.set(key, map.get(key) + total);
  });
  const totals = Array.from(map.values()).filter(v => !isNaN(v)).sort((a,b)=>a-b);
  if (totals.length === 0) return;
  // compute quantile breaks at 1/numClasses .. (numClasses-1)/numClasses
  const breaks = [];
  for (let i = 1; i < numClasses; i++) {
    const q = i / numClasses;
    const idx = Math.floor(q * (totals.length - 1));
    breaks.push(totals[idx]);
  }
  // dedupe breaks and ensure ascending
  globalBreaks = breaks.filter((v,i,a)=>i===0 || v> a[i-1]);

  // create a categorical color range with length = numClasses
  // Use ColorBrewer YlOrRd 6-class palette for high contrast
  const ylOrRd6 = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026", "#800026"];
  const n = numClasses;
  colorRange = [];
  for (let i = 0; i < n; i++) {
    // map i to ylOrRd6 indices (spread across palette)
    const vi = Math.floor((i / Math.max(1, n-1)) * (ylOrRd6.length - 1));
    colorRange.push(ylOrRd6[vi]);
  }
}

// store available years as an indexed list so the slider can map indices -> actual year values
let yearsList = [];
function populateFilters(data) {
  yearsList = Array.from(new Set(data.map(d => d.year))).sort((a,b)=>a-b);

  const yearSlider = document.getElementById('yearSlider');
  const yearValue = document.getElementById('yearValue');
  // configure slider to index into yearsList
  yearSlider.min = 0;
  yearSlider.max = Math.max(0, yearsList.length - 1);
  yearSlider.step = 1;
  // default to latest year (highest index)
  yearSlider.value = yearsList.length - 1;
  yearValue.textContent = yearsList[yearSlider.value] || '';

  const seasonSelect = document.getElementById('seasonSelect');

  // helper to populate seasons based on selected year
  function populateSeasonsForYear(selectedYear) {
    // find unique seasons available for that year
    const seasonsForYear = Array.from(new Set(data.filter(d=>d.year==selectedYear).map(d=>d.games_type))).sort();
    // clear existing options
    seasonSelect.innerHTML = '';
    seasonsForYear.forEach(s => {
      const opt = document.createElement('option'); opt.value = s; opt.text = s; seasonSelect.appendChild(opt);
    });
    // if no seasons, leave blank
    if (seasonsForYear.length === 0) {
      const opt = document.createElement('option'); opt.value = ''; opt.text = 'N/A'; seasonSelect.appendChild(opt);
    }
  }

  // helper to get the currently selected year from the slider (maps index -> actual year)
  function getSelectedYearFromSlider() {
    const idx = Number(document.getElementById('yearSlider').value || 0);
    return yearsList[Math.min(Math.max(0, idx), yearsList.length - 1)];
  }

  // default to latest year and populate seasons for it
  const defaultYear = yearsList[yearsList.length-1];
  populateSeasonsForYear(defaultYear);
  // ensure first season is selected if available
  const firstSeason = document.getElementById('seasonSelect').options[0];
  if (firstSeason) firstSeason.selected = true;

  // events: slider input -> update displayed year, repopulate seasons and render; season change -> render
  yearSlider.addEventListener('input', function() {
    const selectedYear = getSelectedYearFromSlider();
    yearValue.textContent = selectedYear || '';
    populateSeasonsForYear(selectedYear);
    const fs = document.getElementById('seasonSelect').options[0]; if (fs) fs.selected = true;
    updateAndRender();
  });
  seasonSelect.addEventListener('change', updateAndRender);

}

// Aggregate medals by country for current filters
function aggregateByCountry(year, season) {
  const filtered = csvData.filter(d => d.year == year && d.games_type == season);
  const map = new Map();
  filtered.forEach(r => {
    const c = r.country;
    const gold = Number(r.gold) || 0;
    const silver = Number(r.silver) || 0;
    const bronze = Number(r.bronze) || 0;
    const total = gold + silver + bronze;
    if (!map.has(c)) map.set(c, {country: c, gold: 0, silver:0, bronze:0, total:0});
    const cur = map.get(c);
    cur.gold += gold; cur.silver += silver; cur.bronze += bronze; cur.total += total;
  });
  return Array.from(map.values());
}

// Build Vega-Lite spec and render using vegaEmbed
async function updateAndRender() {
  if (!csvData) return;
  // read year from slider index mapping
  const yearSlider = document.getElementById('yearSlider');
  const year = yearsList[Math.min(Math.max(0, Number(yearSlider.value || 0)), yearsList.length - 1)];
  const season = document.getElementById('seasonSelect').value;
  aggregated = aggregateByCountry(year, season);

  // build color encoding depending on whether quantile breaks are available
  const colorEncoding = (globalBreaks && globalBreaks.length > 0) ?
    {
      "field": "totalMedals",
      "type": "quantitative",
      "scale": {"type": "threshold", "domain": globalBreaks, "range": colorRange},
      "legend": {"title": "Total medals","orient":"right","format":"d","labelExpr":"datum.value"}
    }
    :
    {
      "field": "totalMedals",
      "type": "quantitative",
      "scale": {"scheme":"inferno","type":"sqrt","domain":[0, globalMaxTotal]},
      "legend": {"title":"Total medals","orient":"right","format":"d","tickCount":6}
    };

  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": "container",
    "height": 520,
    "autosize": {"type": "fit", "contains": "padding"},
  "background": "#a6d0ff",
    "projection": {"type": "equalEarth"},
    "layer": [
      {
        "data": {"url": "./js/ne_110m.topojson", "format": {"type":"topojson","feature":"countries"}},
        "transform": [{"calculate": "'Data is not available in ' + datum.properties.NAME", "as":"note"}],
        "mark": {"type":"geoshape", "fill": "#eee", "stroke": "white"},
        "encoding": {"tooltip": {"field": "note"}}
      },
      {
        // join mapped country features with aggregated values via lookup
        "data": {"url": "./js/ne_110m.topojson", "format": {"type":"topojson","feature":"countries"}},
        "transform": [
          {
            "lookup": "properties.NAME",
            "from": { "data": {"values": aggregated}, "key": "country", "fields": ["gold","silver","bronze","total"] }
          },
          {"calculate": "(datum.gold || 0) + (datum.silver || 0) + (datum.bronze || 0)", "as": "totalMedals"},
          {"calculate": "datum.gold == null ? 'Did not participate' : null", "as": "participation_note"},
          {"calculate": "datum.gold == null ? 'Did not participate' : ('Gold: ' + (datum.gold || 0) + ', Silver: ' + (datum.silver || 0) + ', Bronze: ' + (datum.bronze || 0) + ', Total: ' + (datum.totalMedals || 0))", "as": "status"}
        ],
        "mark": {"type":"geoshape","stroke":"white","strokeWidth":0.5},
        "encoding": {
          "color": colorEncoding,
          "tooltip": [
            {"field":"properties.NAME","type":"nominal","title":"Country"},
            {"field":"status","type":"nominal","title":""}
          ]
        }
      }
    ]
  };

  // embed the Vega-Lite map (Vega's built-in legend will be used)
  vegaEmbed('#map', spec, {actions:false})
    .catch(err => { console.warn('Map failed to render:', err); })
    .finally(() => {
      // Render all other charts regardless of map success
      try { renderBarChart(10); } catch(e) { console.error('renderBarChart error', e); }
      try { renderBubbleChart(year, season); } catch(e) { console.error('renderBubbleChart error', e); }
      try { populateCountryDropdownAndRenderDonut(year, season); } catch(e) { console.error('renderDonutChart error', e); }
      try { renderGlobalDonut(year, season); } catch(e) { console.error('renderGlobalDonut error', e); }
      try { renderHostVsRestDonut(year, season); } catch(e) { console.error('renderHostVsRestDonut error', e); }
      try { renderTopShareDonut(year, season); } catch(e) { console.error('renderTopShareDonut error', e); }
    });
}

// Render a Top-N horizontal bar chart of countries by total medals for current filters
function renderBarChart(N) {
  if (!aggregated || aggregated.length === 0) {
    document.getElementById('bar').innerHTML = '';
    return;
  }
  // fixed metric to total (metric dropdown removed)
  const metric = 'total';
  // sort by chosen metric and prepare top-N
  const top = aggregated.slice().sort((a,b) => ((b[metric]||0) - (a[metric]||0))).slice(0, N);
  const barSpec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "background": "#f6eedc",
    "width": "container",
    "height": Math.min(50 + top.length * 25, 400),
    "autosize": {"type": "fit", "contains": "padding"},
  "data": {"values": top},
    // compute mean separately for annotation layers where needed
    "autosize": {"type":"fit", "contains": "padding"},
    "layer": [
      {
        "mark": "bar",
        "encoding": {
          "y": {"field": "country", "type": "ordinal", "sort": "-x", "title": null},
          "x": {"field": metric, "type": "quantitative", "title": (metric === 'total' ? "Total medals" : metric.charAt(0).toUpperCase() + metric.slice(1))},
          "color": {"value": "#4c78a8"},
          "tooltip": [
            {"field":"country","type":"nominal","title":"Country"},
            {"field":"gold","type":"quantitative","title":"Gold"},
            {"field":"silver","type":"quantitative","title":"Silver"},
            {"field":"bronze","type":"quantitative","title":"Bronze"},
            {"field":"total","type":"quantitative","title":"Total"}
          ]
        }
      },
      {
        // numeric label at end of each bar for chosen metric
        "mark": {"type":"text", "align":"left", "dx":6, "dy":0, "fontSize":11},
        "encoding": {
          "y": {"field": "country", "type": "ordinal", "sort": "-x", "title": null},
          "x": {"field": metric, "type": "quantitative"},
          "text": {"field": metric, "type": "quantitative", "format": "d"},
          "color": {"value": "#222"}
        }
      },
      {
        // vertical mean line (aggregate to single datum) for chosen metric
        "transform": [{"aggregate": [{"op": "mean", "field": metric, "as": "meanMetric"}]}],
  "mark": {"type": "rule", "color": "#c8a96a", "strokeWidth": 2},
        "encoding": {
          "x": {"field": "meanMetric", "type": "quantitative"}
        }
      },
      {
        // label for mean line
        "transform": [{"aggregate": [{"op": "mean", "field": metric, "as": "meanMetric"}]}],
  "mark": {"type": "text", "align": "left", "dx":6, "dy":-6, "fontSize":12, "color": "#a17e2c", "fontWeight": "bold"},
        "encoding": {
          "x": {"field": "meanMetric", "type": "quantitative"},
          // place label at top of plot (use a constant pixel y)
          "y": {"value": 6},
          "text": {"field": "meanMetric", "type": "quantitative", "format": ".1f"}
        }
      }
    ]
  };
  vegaEmbed('#bar', barSpec, {actions:false}).catch(console.error);

  // no metric selector — chart always displays Total medals
}


// Safe stub for bubble chart to avoid errors if not implemented yet
function renderBubbleChart(year, season) {
  const el = document.getElementById('bubble');
  if (!el) return;
  if (!aggregated) { el.innerHTML = ''; return; }
  // Scatter: Total medals vs index (sorted by total for clarity)
  const rows = aggregated
    .slice()
    .sort((a,b) => (b.total||0) - (a.total||0))
    .map((d, i) => ({ country: d.country, total: d.total, idx: i+1 }));
  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "background": "#f6eedc",
    "width": "container",
    "height": 320,
    "data": {"values": rows},
    "mark": {"type": "circle", "opacity": 0.8, "stroke": "#fff", "strokeWidth": 0.8},
    "encoding": {
      "x": {"field": "idx", "type": "quantitative", "title": "Country Index"},
      "y": {"field": "total", "type": "quantitative", "title": "Total Medals"},
      "size": {"field": "total", "type": "quantitative", "legend": null, "scale": {"range": [40, 900]}},
      "color": {"field": "total", "type": "quantitative", "scale": {"scheme": "oranges"}, "legend": {"title": "Total medals", "orient": "right"}},
      "tooltip": [
        {"field": "country", "type": "nominal"},
        {"field": "total", "type": "quantitative"}
      ]
    }
  };
  vegaEmbed('#bubble', spec, {actions:false}).catch(console.error);
}

// Populate country dropdown and render donut chart
function populateCountryDropdownAndRenderDonut(year, season) {
  const sel = document.getElementById('countrySelect');
  const donutEl = document.getElementById('donut');
  if (!sel || !donutEl) return; // section may not exist
  // countries with at least one medal
  const medalists = aggregated
    .filter(d => (d.total||0) > 0)
    .sort((a,b) => b.total - a.total)
    .map(d => d.country);

  // preserve current selection if still available
  const prev = sel.value;
  sel.innerHTML = '';
  medalists.forEach(c => {
    const opt = document.createElement('option'); opt.value = c; opt.text = c; sel.appendChild(opt);
  });
  if (medalists.length === 0) {
    donutEl.innerHTML = '<div style="padding:12px;color:#666">No medal-winning countries for this selection.</div>';
    return;
  }
  // pick previous if still present, else first
  const idx = medalists.indexOf(prev);
  sel.value = idx >= 0 ? prev : medalists[0];

  // wire change handler (idempotent: remove existing then add)
  sel.onchange = () => renderDonutChart(year, season, sel.value);
  renderDonutChart(year, season, sel.value);
}

// Donut chart: medal composition for a single country
function renderDonutChart(year, season, country) {
  const el = document.getElementById('donut');
  if (!el) return;
  if (!aggregated || !country) { el.innerHTML = ''; return; }
  const rec = aggregated.find(d => d.country === country);
  if (!rec) { el.innerHTML = '<div style="padding:12px;color:#666">No data for ' + country + '.</div>'; return; }
  const rows = [
    { type: 'Gold', value: rec.gold || 0 },
    { type: 'Silver', value: rec.silver || 0 },
    { type: 'Bronze', value: rec.bronze || 0 }
  ];
  const hasAny = rows.some(r => r.value > 0);
  if (!hasAny) { el.innerHTML = '<div style="padding:12px;color:#666">' + country + ' has no medals.</div>'; return; }

  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "background": "#f6eedc",
  "width": 500,
  "height": 380,
    "data": {"values": rows},
  "mark": {"type": "arc", "innerRadius": 110, "outerRadius": 185, "stroke": "#fff"},
    "encoding": {
      "theta": {"field": "value", "type": "quantitative"},
      "color": {"field": "type", "type": "nominal", "scale": {"domain": ["Gold","Silver","Bronze"], "range": ["#FFD700", "#C0C0C0", "#CD7F32"]},
        "legend": {"title": "Medals", "orient": "right", "labelFontSize": 15, "titleFontSize": 16, "symbolSize": 220, "symbolStrokeColor": "#fff", "symbolStrokeWidth": 0.5}
      },
      "tooltip": [
        {"field": "type", "type": "nominal"},
        {"field": "value", "type": "quantitative", "title": "Medals"}
      ]
    },
    "view": {"stroke": null}
  };
  vegaEmbed('#donut', spec, {actions:false}).catch(console.error);
  try {
    // Fill stats chips under the big donut
    const statsEl = document.getElementById('donut-stats');
    if (statsEl) {
      const total = (rec.total||0);
      statsEl.innerHTML = `
        <span class="stat-chip gold">Gold: ${rec.gold||0}</span>
        <span class="stat-chip silver">Silver: ${rec.silver||0}</span>
        <span class="stat-chip bronze">Bronze: ${rec.bronze||0}</span>
        <span class="stat-chip total">Total: ${total}</span>
      `;
    }
  } catch(e) { /* no-op */ }
}

// Donut A: Global medal mix (sum of gold/silver/bronze across all countries for current filters)
function renderGlobalDonut(year, season) {
  const el = document.getElementById('donut-global');
  if (!el) return;
  if (!aggregated || aggregated.length === 0) { el.innerHTML = '<div style="padding:8px;color:#666">No data.</div>'; return; }
  const totals = aggregated.reduce((acc, d) => {
    acc.gold += d.gold||0; acc.silver += d.silver||0; acc.bronze += d.bronze||0; return acc;
  }, {gold:0,silver:0,bronze:0});
  const rows = [
    { type: 'Gold', value: totals.gold },
    { type: 'Silver', value: totals.silver },
    { type: 'Bronze', value: totals.bronze }
  ];
  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "background": "#f6eedc",
    "width": 260,
    "height": 210,
    "data": {"values": rows},
    "transform": [
      {"joinaggregate": [{"op": "sum", "field": "value", "as": "sumValue"}]},
      {"calculate": "(datum.value / datum.sumValue) * 100", "as": "percent"}
    ],
    "mark": {"type": "arc", "innerRadius": 60, "outerRadius": 95, "stroke": "#fff", "strokeWidth": 1},
    "encoding": {
      "theta": {"field": "value", "type": "quantitative"},
      "color": {"field": "type", "type": "nominal", "scale": {"domain": ["Gold","Silver","Bronze"], "range": ["#FFD700", "#C0C0C0", "#CD7F32"]},
        "legend": {"title": "Global Mix", "orient": "bottom", "labelFontSize": 14, "titleFontSize": 15, "symbolSize": 180}
      },
      "tooltip": [
        {"field": "type", "type": "nominal"},
        {"field": "value", "type": "quantitative", "title": "Medals"},
        {"field": "percent", "type": "quantitative", "format": ".1f", "title": "%"}
      ]
    },
    "view": {"stroke": null}
  };
  vegaEmbed(el, spec, {actions:false}).catch(console.error);
}

// Donut B: Host vs Rest share
function renderHostVsRestDonut(year, season) {
  const el = document.getElementById('donut-host');
  if (!el) return;
  if (!csvData || !aggregated) { el.innerHTML=''; return; }
  // Find host country for this edition
  const hostRow = csvData.find(d => d.year==year && d.games_type==season);
  const host = hostRow ? hostRow.host_country : null;
  let hostTotal = 0, restTotal = 0;
  aggregated.forEach(d => {
    if (host && d.country === host) hostTotal += d.total||0; else restTotal += d.total||0;
  });
  const rows = [
    { type: host ? `Host: ${host}` : 'Host', value: hostTotal },
    { type: 'Rest of Countries', value: restTotal }
  ];
  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "background": "#f6eedc",
    "width": 260,
    "height": 210,
    "data": {"values": rows},
    "transform": [
      {"joinaggregate": [{"op": "sum", "field": "value", "as": "sumValue"}]},
      {"calculate": "(datum.value / datum.sumValue) * 100", "as": "percent"}
    ],
    "mark": {"type": "arc", "innerRadius": 60, "outerRadius": 95, "stroke": "#fff", "strokeWidth": 1},
    "encoding": {
      "theta": {"field": "value", "type": "quantitative"},
      "color": {"field": "type", "type": "nominal", "scale": {"range": ["#8a6a1f", "#e3cf8c"]},
        "legend": {"title": "Host vs Rest", "orient": "bottom", "labelFontSize": 14, "titleFontSize": 15, "symbolSize": 180}
      },
      "tooltip": [
        {"field": "type", "type": "nominal"},
        {"field": "value", "type": "quantitative", "title": "Total Medals"},
        {"field": "percent", "type": "quantitative", "format": ".1f", "title": "%"}
      ]
    },
    "view": {"stroke": null}
  };
  vegaEmbed(el, spec, {actions:false}).catch(console.error);
}

// Donut C: Share of top 5 countries vs others
function renderTopShareDonut(year, season) {
  const el = document.getElementById('donut-topshare');
  if (!el) return;
  if (!aggregated || aggregated.length===0) { el.innerHTML = '<div style="padding:8px;color:#666">No data.</div>'; return; }
  const sorted = aggregated.slice().sort((a,b)=> (b.total||0) - (a.total||0));
  const top5 = sorted.slice(0,5);
  const topTotal = top5.reduce((s,d)=>s+(d.total||0),0);
  const restTotal = sorted.slice(5).reduce((s,d)=>s+(d.total||0),0);
  const rows = [
    { type: 'Top 5', value: topTotal },
    { type: 'Others', value: restTotal }
  ];
  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "background": "#f6eedc",
    "width": 260,
    "height": 210,
    "data": {"values": rows},
    "transform": [
      {"joinaggregate": [{"op": "sum", "field": "value", "as": "sumValue"}]},
      {"calculate": "(datum.value / datum.sumValue) * 100", "as": "percent"}
    ],
    "mark": {"type": "arc", "innerRadius": 60, "outerRadius": 95, "stroke": "#fff", "strokeWidth": 1},
    "encoding": {
      "theta": {"field": "value", "type": "quantitative"},
      "color": {"field": "type", "type": "nominal", "scale": {"range": ["#4c78a8", "#b0c7de"]},
        "legend": {"title": "Top 5 Share", "orient": "bottom", "labelFontSize": 14, "titleFontSize": 15, "symbolSize": 180}
      },
      "tooltip": [
        {"field": "type", "type": "nominal"},
        {"field": "value", "type": "quantitative", "title": "Total Medals"},
        {"field": "percent", "type": "quantitative", "format": ".1f", "title": "%"}
      ]
    },
    "view": {"stroke": null}
  };
  vegaEmbed(el, spec, {actions:false}).catch(console.error);
}


// New Chart 2: Medal Composition (Stacked Bar Chart)
function renderStackedBarChart(year, season) {
  const el = document.getElementById('stacked-bar-chart');
  if (!el || !aggregated) { el.innerHTML = ''; return; }

  const top10 = aggregated.slice().sort((a, b) => b.total - a.total).slice(0, 10);

  if (top10.length === 0) {
    el.innerHTML = '<div style="padding:12px;color:#666">No data for this selection.</div>';
    return;
  }

  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": "container",
    "height": 300,
    "data": {"values": top10},
    "transform": [
      {"fold": ["gold", "silver", "bronze"], "as": ["medal_type", "count"]}
    ],
    "mark": "bar",
    "encoding": {
      "y": {"field": "country", "type": "ordinal", "sort": {"op": "sum", "field": "count", "order": "descending"}, "title": null},
      "x": {"field": "count", "type": "quantitative", "title": "Medal Count"},
      "color": {
        "field": "medal_type",
        "type": "nominal",
        "scale": {"domain": ["gold", "silver", "bronze"], "range": ["#FFD700", "#C0C0C0", "#CD7F32"]},
        "title": "Medal Type"
      },
      "tooltip": [
        {"field": "country", "type": "nominal"},
        {"field": "medal_type", "type": "nominal"},
        {"field": "count", "type": "quantitative"}
      ]
    }
  };
  vegaEmbed(el, spec, {actions: false}).catch(console.error);
}

// New Chart 3: Medals Per Capita (Bar Chart)
function renderPerCapitaBarChart(year, season) {
  const el = document.getElementById('per-capita-bar-chart');
  if (!el || !populationData || !aggregated) { el.innerHTML = ''; return; }

  const popMap = new Map();
  const yStr = String(year);
  populationData.forEach(r => {
    if (r && String(r['Year'] || r['year']).trim() === yStr) {
      const name = (r['Country Name'] || r['country'] || '').trim();
      const val = Number(r['Value'] || r['value']);
      if (name && !isNaN(val) && val > 0) popMap.set(name, val);
    }
  });
  
  function normalize(name) {
    if (!name) return name;
    return name.replace('United States of America','United States')
      .replace('ROC','Russian Federation')
      .replace('Czechia','Czech Republic')
      .replace('Hong Kong, China','Hong Kong SAR, China')
      .replace('Great Britain','United Kingdom')
      .replace("Côte d'Ivoire","Cote d'Ivoire");
  }

  const perCapitaData = [];
  aggregated.forEach(d => {
    const pop = popMap.get(d.country) || popMap.get(normalize(d.country));
    if (pop) {
      perCapitaData.push({
        country: d.country,
        total: d.total,
        population: pop,
        medals_per_million: (d.total / pop) * 1000000
      });
    }
  });

  const top10 = perCapitaData.sort((a, b) => b.medals_per_million - a.medals_per_million).slice(0, 10);

  if (top10.length === 0) {
    el.innerHTML = '<div style="padding:12px;color:#666">No population-matching data.</div>';
    return;
  }

  const spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "width": "container",
    "height": 300,
    "data": {"values": top10},
    "mark": "bar",
    "encoding": {
      "y": {"field": "country", "type": "ordinal", "sort": "-x", "title": null},
      "x": {"field": "medals_per_million", "type": "quantitative", "title": "Medals per Million People"},
      "color": {"value": "#1f77b4"},
      "tooltip": [
        {"field": "country", "type": "nominal"},
        {"field": "medals_per_million", "type": "quantitative", "format": ".3f"},
        {"field": "total", "type": "quantitative", "title": "Total Medals"},
        {"field": "population", "type": "quantitative", "format": ","}
      ]
    }
  };
  vegaEmbed(el, spec, {actions: false}).catch(console.error);
}
