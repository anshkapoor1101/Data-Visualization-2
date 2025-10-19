// Variables to hold parsed CSV and aggregated data
let csvData = null;
let aggregated = [];
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
    updateAndRender();
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
        // ocean/background layer (from uploaded topojson)
        "data": {"url": "./js/ne_110m_ocean.json", "format": {"type":"topojson","feature":"ne_110m_ocean"}},
        "mark": {"type":"geoshape", "fill": "#a6d0ff", "stroke": null},
        "encoding": {}
      },
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
  vegaEmbed('#map', spec, {actions:false}).then(function(mapResult) {
    // render bar under map and align widths
    try { renderBarChart(10); } catch(e) { console.error('renderBarChart error', e); }
    return mapResult;
  }).catch(console.error);
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
        "mark": {"type": "rule", "color": "red", "strokeWidth": 2},
        "encoding": {
          "x": {"field": "meanMetric", "type": "quantitative"}
        }
      },
      {
        // label for mean line
        "transform": [{"aggregate": [{"op": "mean", "field": metric, "as": "meanMetric"}]}],
        "mark": {"type": "text", "align": "left", "dx":6, "dy":-6, "fontSize":12, "color": "red", "fontWeight": "bold"},
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

// (No manual legend; rely on Vega's built-in legend positioned to the right)
