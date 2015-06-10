// Main code of ScraperWiki "Summarise automatically" tool

var meta
var table
var table_ix
var total
var groups = {}
var tab
var saved_table_ix
var nltk_stop_words

// Google Charts have to be late-rendered when the page is visible - this
// stores functions to run for each tab when it is shown
var chart_redrawers = {}

// Blacklist some columns because they are useless
var blacklisted_column = function(col) {
  // Things that end _id are foreign keys - skip for now
  if (col.match(/_id$/) || col == "id" || col == "id_str")
    return true
  // MusicBrainz identifiers (e.g. in Last.fm data)
  if (col.match(/_mbid$/))
    return true
  return false
}

// Given an array of grouped items with their counts, merge empty strings with 
// nulls -- because most users don't care about the difference particularly, we 
// display both as (empty) in the user interface
var merge_empty_and_null = function(col, group) {
  // console.log("col group:", col, group)

  var empty_ix = null
  var null_ix = null
  $.each(group, function(ix, value) {
    if (value.val === null) {
      null_ix = ix
    }
    if (value.val === "") {
      empty_ix = ix
      // use null for empty strings
      value.val = null
    }
    if (null_ix !== null && empty_ix !== null) {
      // this is just an optimisation
      return false
    }
  })
  // we found both a null and an empty entry, merge them
  if (null_ix !== null && empty_ix !== null) {
    group[null_ix].c += group[empty_ix].c
    delete group[empty_ix]
    group.sort(function(a,b) { return b.c - a.c})
    group.length--
    // console.log("NULLMERGED col group:", col, group)
  }
}

// Scores for facts are:
// <100 show only highest which has same col value
// >=100 show multiple ones with score more than 100
// html can either be the html for the fact, or a function which takes
// an empty DOM element as a parameter and inserts itself into it.
var fact_scores = {}
var fact_doms = {}
var add_fact = function(name, score, html, col) {
  // score = 999 // always add

  current_score = fact_scores[col] || 0
  current_dom = fact_doms[col]

  console.log("  col:", col, "found fact:", name, "score:", score, "current_score:", current_score)

  var dom = $('<div class="item" score="' + score + '">')
  var changed = false

  // if the existing item is replaced by new, or new one is always show, show new one
  if (current_score < score || score >= 100) {
    if (typeof(html) == "function") {
      tab.find('.facts .loading').before(dom)
      html(dom)
    } else {
      dom.html(html)
      tab.find('.facts .loading').before(dom)
    }
    changed = true
  }

  // if current item is replaceable (score < 100), replace it
  if (current_score < 100 && current_score < score ) {
    if (current_dom != null) {
      current_dom.remove()
      delete current_dom
      changed = true
    }
    fact_scores[col] = score
    fact_doms[col] = dom
  }

  // rebuild the layout
  if (changed) {
    tab.find('.facts').masonry('reload')
  }
}

// Construct empty tab for one table
var make_tab = function(cb) {
  var tab_id = 'tab_' + table_ix
  var nav_cls = ""
  if (table_ix == saved_table_ix) {
    nav_cls = "active"
  }

  $('body').append('<div class="tab ' + nav_cls + '" id="' + tab_id + '"><div class="facts"></div></div>')
  tab = $("#" + tab_id)
  tab.find('.facts').masonry({ itemSelector : '.item' })
  tab.find('.facts').append('<div class="item"><p class="waiting">Please wait&hellip;</p><p>Summarising other tabs first</p></div>')
  $(".nav").append('<li class="loading ' + nav_cls + '"> <a href="#' + tab_id + '" data-toggle="tab">' + table + '</a> </li>')
  $(".nav").show()
}

// Fill in one table's summary - make the tab in the user interface, and set
// off all the queries of the database necessary to make the summary.
var fill_in_tab = function(cb) {
  console.log("table:", table, "meta:", meta)

  var tab_id = 'tab_' + table_ix
  tab = $("#" + tab_id)
  tab.find('.item').remove()
  tab.find('.facts').append('<p class="loading item">Summarising&hellip;</p>')

  // these are global variables - clear for each tab
  fact_scores = {}
  fact_doms = {}

  var local_tab = tab
  var local_tab_id = tab_id
  var local_table_ix = table_ix
  chart_redrawers[table_ix] = []
  $(".nav a").on("shown", function (e) {
    console.log("tab shown", e.target, e.relatedTarget, "#" + local_tab_id)
    console.log("target href", $(e.target).attr('href'))
    // shown is global for all tabs - this detects we mean this tab activated
    if ($(e.target).attr('href') == "#" + local_tab_id) {
      $.each(chart_redrawers[local_table_ix], function(ix, value) {
        value()
      })
      local_tab.find('.facts').masonry('reload')
      // save tab as default for first time load
      // TODO: Reinstate, probably via localStorage
      localStorage.setItem('summary-tool-web_'+window.location.pathname, JSON.stringify(local_table_ix, null, 4))
    }
  })

  async.auto({
    // Get stopwords
    stopWords: [ function(cb) {
        if (nltk_stop_words != null) {
          cb()
        } else {
          $.getJSON("/static/summary/summary_tool_stopwords.json", function(data) {
            nltk_stop_words = data
            cb()
          }, handle_error)
        }
    } ],
    // Get total number of rows
    getTotal: [ function(cb) {
      select("count(*) as c from `" + table + "`").done(function(data) {
        total = data[0].c
        fact_total_rows()
        // finish early if one or zero rows - nothing else is interesting
        if (total <= 1) 
         cb("onerow")
        else
         cb()
      }).fail(handle_error)
    }],
    // For every column, count the number of meta groupings
    getGroups: [ 'stopWords', 'getTotal', function(cb1) {
      async.forEachLimit(meta.columnNames, 4, function(col, cb2) {
        if (blacklisted_column(col)) {
          cb2()
	  return
        }
        // the nullif here converts empty strings to nulls, to simplify stuff
        select("`" + col + "` as val, count(*) as c from `" + table + "` group by val order by c desc").done(function(group) {
          merge_empty_and_null(col, group)
          groups[col] = group

          fact_one_value(col, group)
          fact_only_one_significant(col, group)
          fact_groups_table(col, group, 0)
          fact_groups_pie(col, group, 0)

          fact_time_charts(col, group)
          fact_countries_chart(col, group)
          fact_states_chart(col, group)
          fact_numbers_chart(col, group)
          fact_numbers_range(col, group)

          fact_image_collage(col, group)
          fact_word_cloud(col, group)
          fact_domain_table(col, group)

          cb2()
      }).fail(handle_error)
      }, function() {
        cb1()
      })
    } ]
  }, function() {
    console.log("table done:", table)
    tab.find('p.loading').remove()
    cb()
  })
}

//TODO: Move these into a place where all blueprint tools can access
var select = function(query) {
  var options;
  options = {
    url: window.selectEndpoint,
    type: "GET",
    dataType: "json",
    data: { q: query, }
  };
  return $.ajax(options);
}

var metaQuery = function() {
  /* Modified from scraperwiki.coffee */
  var options;
  options = {
    url: window.metaEndpoint,
    type: "GET",
    dataType: "json",
  };
  return $.ajax(options);
};

// Main entry point
$(function() {
  window.selectEndpoint = '../select'
  window.metaEndpoint = '../meta'
  
  metaQuery().done(function(lmeta) {
    var tables = _.keys(lmeta.table)
    // filter out tables starting with double underscore
    // (this tool completely ignores such tables)
    tables = _.reject(tables, function(tableName){
      return tableName.slice(0,2) == '__'
      })
    console.log(tables)
    var loadTables = function() {
      // Load last tab to show
      // TODO: Reinstate table saving
      //scraperwiki.exec("cat saved_table_ix", function(new_saved_table_ix) {
      // TODO: Remove saved_table_ix hack
      content = localStorage.getItem('summary-tool-web_'+window.location.pathname)
      if(content) {
        try {
          saved_table_ix = JSON.parse(content)
          console.log("saved_table_ix", saved_table_ix)
          } catch(e) {
          console.log("Failed to parse settings.", String(e), "\n\n" + content)
        }
      }
      var makeTables = function() {
        saved_table_ix = Number(saved_table_ix)
        if (saved_table_ix < 1 || isNaN(saved_table_ix))
          saved_table_ix = 1
        if (saved_table_ix > tables.length)
          saved_table_ix = tables.length

        // construct empty tabs, and build array of table info for looping 
        table_ix = 0
        tables_to_render = []
        _.each(tables, function (key) {
          table = key
          table_ix++
          table_info = { 'ix': table_ix, 'table': table }
          // put the table saved to open on first
          if (table_ix == saved_table_ix) {
            tables_to_render.unshift(table_info)
          } else {
            tables_to_render.push(table_info)
          }
          make_tab()
        })

        // Make each table in series - 'table' and others are 
        // global variables for now
        async.forEachSeries(tables_to_render, function (table_info, cb) {
          table = table_info['table']
          table_ix = table_info['ix']
          meta = lmeta['table'][table]
          fill_in_tab(cb)
        }, function () {
          $('.tip-right').tooltip({ 'placement': 'right' })
          $('.tip-bottom').tooltip({ 'placement': 'bottom' })
        })
      }
    //}
      makeTables()
      }
    loadTables()
  }).fail(handle_error)

  $('#bugs').on('click', function() {
    window.open("https://github.com/frabcus/magic-summary-tool/issues", "_blank")
  })
})
