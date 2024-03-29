var products;
var biomarkers;

var venous_cost_pence = 30*100;


lp_variables_for_biomarkers = function(chosen_biomarkers, options){

  defaults = {
    every_test_penalty_pence: 0,
    venous_penalty_pence: 0, /* This is *in addition* to venous_cost_pence */
    turnaround_day_penalty_pence: 0, /* Note that this accumulates for multiple tests, so doesn't work quite as you'd hope */
    require_venous: false
  }

  if(options){
    options = {...defaults, ...options}
  }else{
    options = defaults
  }


  var filtered_prods = products.filter(function(prod){
   return(chosen_biomarkers.map(b => prod[b]).reduce((a,b) => a+parseInt(b,10), 0) > 0)
  })

  if(options.require_venous == true){
    filtered_prods = filtered_prods.filter(function(prod){
      return(prod.venous_available == 1)
    })
  }

  var variables = {}

  filtered_prods.forEach(function(prod,i){
    var new_var = {
      effective_price_pence: parseInt(prod.price_pence, 10) + ((prod.venous_only == "1" || options.require_venous) ? venous_cost_pence : 0)
    }

    new_var.imagined_cost = new_var.effective_price_pence + options.every_test_penalty_pence
    new_var.imagined_cost = new_var.imagined_cost + ((prod.venous_only == "1" || options.require_venous) ? options.venous_penalty_pence : 0)
    new_var.imagined_cost = new_var.imagined_cost + (parseInt(prod.turnaround_days, 10) * options.turnaround_day_penalty_pence)

    chosen_biomarkers.forEach(b => new_var[b] = parseInt(prod[b], 10))

    variables[prod.product_handle] = new_var
  })

  return(variables)
}

lp_constraints_for_biomarkers = function(chosen_biomarkers){

  var constraints = {}

  chosen_biomarkers.forEach(b => constraints[b] = {"min": 1})

  return(constraints)
}

lp_model_for_biomarkers = function(chosen_biomarkers, options){
  var model = {
    optimize: "imagined_cost",
    opType: "min",
    constraints: lp_constraints_for_biomarkers(chosen_biomarkers),
    variables: lp_variables_for_biomarkers(chosen_biomarkers, options)
  };

  model.ints = {}
  Object.keys(model.variables).forEach( prod => model.ints[prod] = 1)

  return(model)
}

format_price_pence = function(price_pence){
  var ret = price_pence.toString()

  ret = "£" + ret.substring(0, ret.length-2).padStart(1,"0") + "." + ret.substring(ret.length-2, ret.length).padStart(2,"0")

  return(ret)
}

html_span_for_biomarker = function(biomarker){
  return("<span class='biomarker "+ biomarker.category.toLowerCase().replace(" ", "_") +"' data-handle='" + biomarker.biomarker_handle + "'>" + biomarker.name + "</span>")
}

biomarker_for_biomarker_handle = function(biomarker_handle){
  var biomarker = biomarkers.find(biom => biom.biomarker_handle == biomarker_handle)

  if(!biomarker){
    biomarker = {
      biomarker_handle: biomarker_handle,
      name: biomarker_handle,
      category: "Unknown"
    }

  }


  return(biomarker)
}

html_spans_for_biomarker_handles = function(biomarker_handles){
  var rel_biomarkers = biomarker_handles.map(biomarker_for_biomarker_handle)

  rel_biomarkers.sort(function(a,b){

    if(a.category < b.category){
      return(-1)
    }


    if(a.category > b.category){
      return(1)
    }

    return(0)
  })

  return(rel_biomarkers.map(html_span_for_biomarker).join(" "))
}

html_for_product_handle = function(product_handle, require_venous){

  var product = products.find(prod => prod.product_handle == product_handle)

  var url = "https://medichecks.com/products/" + product_handle

  var ret = "<tr><td><a target='_blank' rel='noreferrer nofollow noopener external' referrerpolicy='no-referrer' " + 
    "href='" + url + "'>" + product.title + "</a></td><td>" + format_price_pence(product.price_pence) + "</td></tr>"

  if(product.venous_only == "1" || require_venous){
    ret = ret + "<tr class='venous collection'><td>+ venous collection</td><td>" + format_price_pence(venous_cost_pence) + "</td></tr>"
  }

  return(ret)
}

html_for_result = function(result, require_venous){

  var suggested_products = products.filter(prod => (result.suggested_test_handles.indexOf(prod.product_handle) >= 0))

  var total_cost = suggested_products.map(prod => parseInt(prod.price_pence, 10)).reduce((a,b) => a+b, 0)

  total_cost = total_cost + suggested_products.map(prod => (prod.venous_only == "1" || require_venous) ? venous_cost_pence : 0).reduce((a,b) => a+b, 0)

   return(`<div class="result"><table class="suggested_tests">
      <thead>
        <tr>
          <th>Test</th>
          <th>Cost</th>
        </tr>
      </thead>

      <tbody>` + 
        result.suggested_test_handles.map(h => html_for_product_handle(h, require_venous)).join("\n")
      + "<tr class='total-row'><td>Total</td><td>"+ format_price_pence(total_cost) + "</td></tr>" +
      `
      </tbody>

    </table>` +
    (result.additional_biomarkers.length ? `<p class='additional-biomarkers'>Also has: ` + html_spans_for_biomarker_handles(result.additional_biomarkers) + "</p>" : "") + 
    (result.missing_biomarkers.length ? `<p class='missing-biomarkers'><em>Doesn't</em> have: ` + html_spans_for_biomarker_handles(result.missing_biomarkers) + "</p>" : "") + 
    "</div>")
}


resolve = function(){
  var chosen_biomarkers = $("#biomarkers-select").val().sort()
  var require_venous = $("#require-venous-checkbox").is(":checked")

  var query_params = new URLSearchParams(window.location.search);
  query_params.set("biomarkers", chosen_biomarkers.join(","))
  query_params.set("require_venous", require_venous)
  history.replaceState(null, null, "?"+query_params.toString());

  $("#outputs").empty()

  if(!products){
    return
  }

  if(!biomarkers){
    return
  }

  if(chosen_biomarkers.length == 0){
    $("#outputs").append("<p>Add some required biomarkers to see suggested test sets.</p>")
    return;
  }

  var result

  results = []

  var suggested_test_handles_for_result = function(result){
    return(Object.keys(result).filter(k => !(["feasible", "result", "bounded", "isIntegral"].includes(k))).sort())
  }

  var find_matching_result = function(r2){
    var ret = results.find(r1 => 
      r2.suggested_test_handles.every(a => r1.suggested_test_handles.includes(a)) && 
      r1.suggested_test_handles.every(a => r2.suggested_test_handles.includes(a)))
    return(ret)
  }

  /*
    First attempt, we just try to find the cheapest
  */

  var model = lp_model_for_biomarkers(chosen_biomarkers, {require_venous: require_venous})
  result = solver.Solve(model)
  result.suggested_test_handles = suggested_test_handles_for_result(result)
  results.push(result)

  /* 
    We try to find an alternative with a completely different set of tests
  */

  result.suggested_test_handles.forEach(h => delete model.variables[h])
  
  result = solver.Solve(model)
  result.suggested_test_handles = suggested_test_handles_for_result(result)

  if(result.feasible && !find_matching_result(result)){
    results.push(result)
  }

  /* We try to avoid multiple tests and venous tests */

  model = lp_model_for_biomarkers(chosen_biomarkers, {require_venous: require_venous, every_test_penalty_pence: 500, venous_penalty_pence: 1500})
  result = solver.Solve(model)
  result.suggested_test_handles = suggested_test_handles_for_result(result)

  if(result.feasible && !find_matching_result(result)){
    results.push(result)
  }

  /* We *really* try to avoid multiple tests and venous tests */

  model = lp_model_for_biomarkers(chosen_biomarkers, {require_venous: require_venous, every_test_penalty_pence: 2000, venous_penalty_pence: 6000})
  result = solver.Solve(model)
  result.suggested_test_handles = suggested_test_handles_for_result(result)

  if(result.feasible && !find_matching_result(result)){
    results.push(result)
  }

  /* Some people might actually prefer a venous blood draw, particularly if turnaround is quicker*/

  model = lp_model_for_biomarkers(chosen_biomarkers, {require_venous: require_venous, every_test_penalty_pence: 5000, venous_penalty_pence: -3500, turnaround_day_penalty_pence: 500})
  result = solver.Solve(model)
  result.suggested_test_handles = suggested_test_handles_for_result(result)

  if(result.feasible && !find_matching_result(result)){
    results.push(result)
  }


  /* We try to add some biomarkers for common undiagnosed conditions */

  var chosen_plus_suggested_biomarkers = [...chosen_biomarkers, 'ggt', 'creatinine', 'ldl-cholesterol']

  model = lp_model_for_biomarkers(chosen_plus_suggested_biomarkers, {require_venous: require_venous})
  result = solver.Solve(model)
  result.suggested_test_handles = suggested_test_handles_for_result(result)

  if(result.feasible && !find_matching_result(result)){
    results.push(result)
  }


  /* If either sex hormone is required, suggest adding SHBG */

  if(['testosterone', 'oestradiol'].some(e => chosen_biomarkers.includes(e))){
    chosen_plus_suggested_biomarkers.push('shbg')
    model = lp_model_for_biomarkers(chosen_plus_suggested_biomarkers, {require_venous: require_venous})
    result = solver.Solve(model)
    result.suggested_test_handles = suggested_test_handles_for_result(result)

    if(!find_matching_result(result)){
      results.push(result)
    }
  }

  /* If oestradiol is required, suggest adding Vitamin D */

  if(['oestradiol'].some(e => chosen_biomarkers.includes(e))){
    chosen_plus_suggested_biomarkers.push('vitamin-d')
    model = lp_model_for_biomarkers(chosen_plus_suggested_biomarkers, {require_venous: require_venous})
    result = solver.Solve(model)
    result.suggested_test_handles = suggested_test_handles_for_result(result)

    if(result.feasible && !find_matching_result(result)){
      results.push(result)
    }
  }


  if(results.length == 0){
    $("#outputs").append("<p>Something went wrong!</p>")
    return;
  }

  biomarkers_for_results = results.map( 
    r => products.
      filter(p => r.suggested_test_handles.includes(p.product_handle)).
      map(p => biomarkers.map(b => b.biomarker_handle).filter(b => p[b] == 1)).
      reduce((a,b) => a.concat(b), [] )
    ).map(bs => [...new Set(bs)].sort())


  var biomarker_counts = biomarkers_for_results.flat().reduce((acc, e) => acc.set(e, (acc.get(e) || 0) + 1), new Map());
  var common_biomarkers = [...biomarker_counts].filter(bc => bc[1] >= Math.ceil(results.length * 2/3)).map(bc => bc[0])


  results.forEach(function(e,i){
    e.additional_biomarkers = biomarkers_for_results[i].filter( b => !(common_biomarkers.includes(b)))
    e.missing_biomarkers = common_biomarkers.filter( b => !(biomarkers_for_results[i].includes(b)))
  })

  var common_biomarkers_minus_chosen = common_biomarkers.filter(b => !(chosen_biomarkers.includes(b)))

  if(common_biomarkers_minus_chosen.length > 0){
    $("#outputs").append("<p id='common-biomarkers'>Most options for the required biomarkers also include: " +  
      html_spans_for_biomarker_handles(common_biomarkers_minus_chosen) + "</p>")
  }

  results.forEach(r => 
    $("#outputs").append(html_for_result(r, require_venous))
  )


}

window.addEventListener("load", function() {

  const params = new Proxy(new URLSearchParams(window.location.search), {
      get: (searchParams, prop) => searchParams.get(prop),
  });

  var error_loading = function(){
    $("html").addClass("major-error")
  }

  var check_if_all_loaded = function(){
    if(!biomarkers || !products){
      return
    }

    resolve()

    $("html").addClass("loaded")

  }

  Papa.parse("https://stupidpupil.github.io/medichecks_scraper/biomarkers.csv?" + (new Date).toISOString().substring(0,10), 
    {download: true, header: true, 
      complete: function(ret){
        biomarkers = ret.data

        biomarkers.forEach(b => $("#biomarkers-select").append("<option value='"+b.biomarker_handle+"'>"+b.name+"</option>"))
        s2 = $("#biomarkers-select").select2()

        s2.on("change", resolve)

        if(params.biomarkers){
          var param_biomarkers = params.biomarkers.split(",").filter(k => biomarkers.map(b => b.biomarker_handle).includes(k))
          s2.val(param_biomarkers)
          s2.trigger("change")
        }


        check_if_all_loaded()
      },
      error: error_loading
    })


  Papa.parse("https://stupidpupil.github.io/medichecks_scraper/products.csv?" + (new Date).toISOString().substring(0,10) + "v2", 
    {download: true, header: true, 
    complete: function(ret){
      products = ret.data

      var require_venous = (params.require_venous == "true")
      $("#require-venous-checkbox").prop("checked", require_venous)
      $("#require-venous-checkbox").on("change", resolve)

      check_if_all_loaded()
    },
    error: error_loading
    })

})