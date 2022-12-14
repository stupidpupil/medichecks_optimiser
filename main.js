var products;
var biomarkers;


lp_variables_for_biomarkers = function(biomarkers){
  var filtered_prods = products.filter(function(prod){
   return(biomarkers.map(b => prod[b]).reduce((a,b) => a+parseInt(b,10), 0) > 0)
  })

  var variables = {}

  filtered_prods.forEach(function(prod,i){
    var new_var = {
      effective_price_pence: parseInt(prod.price_pence, 10) + (prod.venous_only == "1" ? 3000 : 0)
    }

    new_var.imagined_cost = new_var.effective_price_pence + 200 + (prod.venous_only == "1" ? 1000 : 0)

    biomarkers.forEach(b => new_var[b] = parseInt(prod[b], 10))

    variables[prod.product_handle] = new_var
  })

  return(variables)
}

lp_constraints_for_biomarkers = function(biomarkers){

  var constraints = {}

  biomarkers.forEach(b => constraints[b] = {"min": 1})

  return(constraints)
}

lp_model_for_biomarkers = function(biomarkers){
  var model = {
    optimize: "imagined_cost",
    opType: "min",
    constraints: lp_constraints_for_biomarkers(biomarkers),
    variables: lp_variables_for_biomarkers(biomarkers)
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


html_for_product_handle = function(product_handle){

  var product = products.find(prod => prod.product_handle == product_handle)

  var url = "https://medichecks.com/products/" + product_handle

  var venous = product.venous_only == 1 ? "<span class='venous_only'>Yes</span>" : "<span class='not_venous_only'>No</span>"

  var ret = "<tr><td><a target='_blank' href='" + url + "'>" + product_handle + "</a></td><td>" + venous + "</td><td>" + format_price_pence(product.price_pence) + "</td></tr>"

  return(ret)
}

html_for_result = function(result){

  var total_cost = products.filter(prod => (result.suggested_test_handles.indexOf(prod.product_handle) >= 0)).map(prod => parseInt(prod.price_pence, 10)).reduce((a,b) => a+b, 0)


   return(`<div class="result"><table class="suggested_tests">
      <thead>
        <tr>
          <th>Test</th>
          <th>Venous?</th>
          <th>Cost</th>
        </tr>
      </thead>

      <tbody>` + 
        result.suggested_test_handles.map(h => html_for_product_handle(h)).join("\n")
      + "<tr class='total-row'><td>Total</td><td></td><td>"+ format_price_pence(total_cost) + "</td></tr>" +
      `
      </tbody>

    </table>` +
    (result.additional_biomarkers.length ? `<p class='additional-biomarkers'>Also has: ` + result.additional_biomarkers.map(b => "<span>"+b+"</span>").join(" ") + "</p>" : "") + 
    (result.missing_biomarkers.length ? `<p class='missing-biomarkers'>Doesn't have: ` + result.missing_biomarkers.map(b => "<span>"+b+"</span>").join(" ") + "</p>" : "") + 
    "</div>")
}


resolve = function(){
  var chosen_biomarkers = $("#biomarkers-select").val().sort()

  var query_params = new URLSearchParams(window.location.search);
  query_params.set("biomarkers", chosen_biomarkers.join(","))
  history.replaceState(null, null, "?"+query_params.toString());

  $("#outputs").empty()

  var model = lp_model_for_biomarkers(chosen_biomarkers)
  var result

  results = []

  for (var i = 4 - 1; i >= 0; i--) {
    
    result = solver.Solve(model)

    if (!result.feasible) {
      break
    }

    result.suggested_test_handles = Object.keys(result).filter(k => ["feasible", "result", "bounded", "isIntegral"].indexOf(k) < 0)
    result.suggested_test_handles.forEach(h => delete model.variables[h])

    results.push(result)
  }

  if(results.length == 0){
    $("#outputs").append("<p>Something went wrong!</p>")
    return;
  }

  biomarkers_for_results = results.map( 
    r => products.
      filter(p => r.suggested_test_handles.indexOf(p.product_handle) >= 0).
      map(p => biomarkers.filter(b => p[b] == 1)).
      reduce((a,b) => a.concat(b), [] )
    ).map(bs => [...new Set(bs)].sort())


  var biomarker_counts = biomarkers_for_results.flat().reduce((acc, e) => acc.set(e, (acc.get(e) || 0) + 1), new Map());
  common_biomarkers = [...biomarker_counts].filter(bc => bc[1] >= Math.ceil(results.length * 2/3)).map(bc => bc[0])


  results.forEach(function(e,i){
    e.additional_biomarkers = biomarkers_for_results[i].filter( b => common_biomarkers.indexOf(b) < 0)
    e.missing_biomarkers = common_biomarkers.filter( b => biomarkers_for_results[i].indexOf(b) < 0)
  })

  console.log(results)

  $("#outputs").append("<p id='common-biomarkers'>Most options for the required biomarkers also include: " +  
    common_biomarkers.filter(b => chosen_biomarkers.indexOf(b) < 0).map(b => "<span>" + b + "</span>").join(" ") + "</p>")

  results.forEach(r => 
    $("#outputs").append(html_for_result(r))
  )


}

$(function() {

  const params = new Proxy(new URLSearchParams(window.location.search), {
      get: (searchParams, prop) => searchParams.get(prop),
  });


  Papa.parse("https://stupidpupil.github.io/medichecks_scraper/products.csv", 
    {download: true, header: true, 
    complete: function(ret){
      products = ret.data

      biomarkers = Object.keys(products[0]).filter(k => ["product_handle", "price_pence", "venous_only"].indexOf(k) < 0)
      biomarkers.forEach(b => $("#biomarkers-select").append("<option value='"+b+"'>"+b+"</option>"))
      s2 = $("#biomarkers-select").select2()

      s2.on("change", resolve)

      if(params.biomarkers){
        var param_biomarkers = params.biomarkers.split(",").filter(k => biomarkers.indexOf(k) >= 0)
        s2.val(param_biomarkers)
        s2.trigger("change")
      }


    }})

})