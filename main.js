var products;


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

html_for_suggested_tests = function(suggested_test_handles){

  var total_cost = products.filter(prod => (suggested_test_handles.indexOf(prod.product_handle) >= 0)).map(prod => parseInt(prod.price_pence, 10)).reduce((a,b) => a+b, 0)


   return(`
   <table class="suggested_tests">
      <thead>
        <tr>
          <th>Test</th>
          <th>Venous?</th>
          <th>Cost</th>
        </tr>
      </thead>

      <tbody>` +
      suggested_test_handles.map(h => html_for_product_handle(h))
      + "<tr class='total-row'><td>Total</td><td></td><td>"+ format_price_pence(total_cost) + "</td></tr>" +
      `
      </tbody>

    </table>`)
}


resolve = function(){
  var biomarkers = $("#biomarkers-select").val().sort()

  var query_params = new URLSearchParams(window.location.search);
  query_params.set("biomarkers", biomarkers.join(","))
  history.replaceState(null, null, "?"+query_params.toString());

  var model = lp_model_for_biomarkers(biomarkers)

  var result = solver.Solve(model)

  $("#outputs").empty()

  if(!result.feasible){
     $("#outputs").append("<p>Something didn't work properly, sorry.</p>")
    return;
  }

  var suggested_test_handles = Object.keys(result).filter(k => ["feasible", "result", "bounded", "isIntegral"].indexOf(k) < 0)
  $("#outputs").append(html_for_suggested_tests(suggested_test_handles))


  var model2 = model;
  suggested_test_handles.forEach(h => delete model2.variables[h])

  var result2 = solver.Solve(model2)

  if(!result2.feasible){
    return;
  }
  
  suggested_test_handles = Object.keys(result2).filter(k => ["feasible", "result", "bounded", "isIntegral"].indexOf(k) < 0)

  $("#outputs").append(html_for_suggested_tests(suggested_test_handles))


  var model3 = model2;
  suggested_test_handles.forEach(h => delete model3.variables[h])

  var result3 = solver.Solve(model3)

  if(!result3.feasible){
    return;
  }
  
  suggested_test_handles = Object.keys(result3).filter(k => ["feasible", "result", "bounded", "isIntegral"].indexOf(k) < 0)

  $("#outputs").append(html_for_suggested_tests(suggested_test_handles))



}

$(function() {

  const params = new Proxy(new URLSearchParams(window.location.search), {
      get: (searchParams, prop) => searchParams.get(prop),
  });


  Papa.parse("products.csv", 
    {download: true, header: true, 
    complete: function(ret){
      products = ret.data

      var biomarkers = Object.keys(products[0]).filter(k => ["product_handle", "price_pence", "venous_only"].indexOf(k) < 0)
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