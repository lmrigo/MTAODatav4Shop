sap.ui.define([
	"nw/epm/refapps/shop/controller/BaseController",
	"sap/ui/core/UIComponent",
	"nw/epm/refapps/shop/reuse/util/TableOperationsV2",
	"nw/epm/refapps/shop/controller/ProductListGrouping",
	"sap/ui/core/mvc/ViewType",
	"nw/epm/refapps/shop/reuse/util/messages",
	"sap/m/MessageToast",
	"sap/m/TablePersoController",
	"sap/m/GroupHeaderListItem",
	"sap/m/BusyDialog",
	"sap/m/SelectDialog",
	"sap/ui/model/Sorter",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/Device",
	"nw/epm/refapps/shop/reuse/util/formatter"
	/* eslint-disable */ // using more then 8 parameters for a function is justified here
], function(BaseController, UIComponent, TableOperations, ProductListGrouping, ViewType, messages, MessageToast,
	TablePersoController, GroupHeaderListItem, BusyDialog, SelectDialog, Sorter, Filter, FilterOperator, Device,
	formatterReuse) {
	/* eslint-enable */ // using more then 8 parameters for a function is justified here

	"use strict";

	return BaseController.extend("nw.epm.refapps.shop.controller.S2_ProductList", {
		formatterReuse: formatterReuse,
		_bDefaultFilterLoaded: true,

		onInit: function() {
			this._oView = this.getView();
			this._oResourceBundle = this.getResourceBundle();
			this._oRouter = this.getOwnerComponent().getRouter();

			var oViewModel = new sap.ui.model.json.JSONModel({
				personalizationActive: false,
				catalogTitle: this._oResourceBundle.getText("xtit.products"),
				tableBusyDelay: 0
			});

			this._oCatalog = this.byId("catalogTable");

			// Put down worklist table's original value for busy indicator delay,
			// so it can be restored later on. Busy handling on the table is
			// taken care of by the table itself.
			var iOriginalBusyDelay = this._oCatalog.getBusyIndicatorDelay();

			this.setModel(oViewModel, "productListView");

			// Make sure, busy indication is showing immediately so there is no
			// break after the busy indication for loading the view's meta data is
			// ended (see promise 'oWhenMetadataIsLoaded' in AppController)
			this._oCatalog.attachEventOnce("updateFinished", function() {
				// Restore original busy indicator delay for worklist's table
				oViewModel.setProperty("/tableBusyDelay", iOriginalBusyDelay);
			});

			// disable the link to multi product view
			oViewModel.setProperty("/hasSelectedItems", false);
			oViewModel.setProperty("/openLinkText", this._oResourceBundle.getText("xbut.openItems"));
			oViewModel.setProperty("/addItemsToCartText", this._oResourceBundle.getText("xbut.addToCart"));

			this._oHeaderButton = this.byId("productListHeaderButton");

			// Prepare the personalization service for the product table
			this._oTablePersoController = null;
			this._initPersonalization();

			// Sorting and grouping on the product table follows a certain logic, which is outsourced to a helper class 1.
			// Selecting a sorter on the table adds the new sorter as the main sorter to all existing sorters 2. If grouping
			// and sorting are both set for the same attribute then the direction (ascending/descending) has to be aligned
			// The actual updating of the List Binding is done by the call back method which is handed over to the
			// constructor.
			//var that = this;
			this._oTableOperations = new TableOperations(this._oCatalog, ["Name", "Id", "Description"]);

			this._oGrouping = new ProductListGrouping(this._oTableOperations, this._oView);

			// // add smart filter bar sub view to page
			this._oSmartFilterBar = this.byId("smartFilterBar");
			this._oCustomFilter = this.byId("averageRatingComboBox");
			if (!sap.ushell.Container) {
				if (this._oSmartFilterBar) {
					this._oSmartFilterBar.setPersistencyKey(null);
				}
			}

			// Navigate to the Product Details from outside
			var oComponentData = this.getOwnerComponent().getComponentData();
			if (oComponentData && oComponentData.startupParameters && jQuery.isArray(oComponentData.startupParameters.Product) &&
				oComponentData.startupParameters.Product.length > 0) {
				var sUrl = this._oRouter.getURL("ProductDetails", {
					productId: oComponentData.startupParameters.Product[0]
				});
				if (sUrl) {
					sap.ui.require(["sap/ui/core/routing/HashChanger"], function(HashChanger) {
						var oHashChanger = HashChanger.getInstance();
						oHashChanger.replaceHash(sUrl);
					});
					return;
				}
			}
			this.getRouter().getRoute("ProductList").attachPatternMatched(this._onRouteProductListMatched, this);
		},

		_onRouteProductListMatched: function(oEvent) {
			if (oEvent.getParameter("name") !== "ProductList") {
				return;
			}
		},

		createGroupHeader: function(oGroup) {
			return new GroupHeaderListItem({
				title: oGroup.text,
				upperCase: false
			});
		},

		// The list title displays the number of list items. Therefore the number has to be updated each
		// time the list changes. Note: the list binding returns the number of items matching the current filter criteria
		// even if the growing list does not yet show all of them. This method is also used by the smart filter bar subview.
		onUpdateFinished: function(oEvent) {
			var iItemCount = oEvent.getParameter("total");
			this.getModel("productListView").setProperty("/catalogTitle",
				iItemCount ?
				this._oResourceBundle.getText("xtit.productsAndCount", [iItemCount]) :
				this._oResourceBundle.getText("xtit.products"));
		},

		// --- Shopping Cart Handling
		onShoppingCartPressed: function() {
			this._oRouter.navTo("ShoppingCart", {}, false);
		},
		// This handler function is called when adding a new item to the shopping cart was unsuccessful
		onCartSrvError: function(oResponse) {
			messages.showErrorMessage(oResponse, this._oResourceBundle.getText("xtit.errorTitle"));
		},

		// This handler function is called when a new item was successfully added to the shopping cart. 
		onCartSrvSuccess: function(oEvent) {
			var oModel = this.getOwnerComponent().getModel();
			var sKey = oModel.createKey("/Products", {
				Id: this._sProductId
			});
			var sProductName = oModel.getProperty(sKey).Name;
			MessageToast.show(this._oResourceBundle.getText("ymsg.addProduct", [sProductName]));
			this._oHeaderButton.getElementBinding().refresh();
		},

		// --- List Handling

		// When an item is added to the shopping cart, this method triggers the service call to the back end.
		// Using a function import, the back end then creates a shopping cart if none exists yet, or
		// adds a new shopping cart item to an existing cart, or updates an existing item if the added
		// product is already in the shopping cart
		onAddToCartPressed: function(oEvent) {
			this._sProductId = oEvent.getSource().getBindingContext().getObject().Id;
			this.getOwnerComponent().getModel().callFunction("/AddProductToShoppingCart", {
				method: "POST",
				urlParameters: {
					ProductId: this._sProductId
				},
				success: this.onCartSrvSuccess.bind(this),
				error: this.onCartSrvError.bind(this)
			});
		},

		onGroupPressed: function() {
			this._oGrouping.openGroupingDialog();
		},

		onSortPressed: function() {
			if (!this._oSortDialog) {
				this._oSortDialog = sap.ui.xmlfragment("nw.epm.refapps.shop.view.fragment.ProductSortDialog", this);
				this.attachControl(this._oSortDialog);
			}
			this._oSortDialog.open();
		},

		// Handler for the Confirm button of the sort dialog. Depending on the selections made on the sort
		// dialog, the respective sorters are created and stored in the _oTableOperations object.
		// The actual setting of the sorters on the binding is done by the callback method that is handed over to
		// the constructor of the _oTableOperations object.
		onSortDialogConfirmed: function(oEvent) {
			var mParams = oEvent.getParameters(),
				sSortPath = mParams.sortItem.getKey();
			this._oTableOperations.addSorter(new Sorter(sSortPath, mParams.sortDescending));
			this._oTableOperations.applyTableOperations();
		},

		// --- Personalization
		onPersonalizationPressed: function() {
			this._oTablePersoController.openDialog();
		},

		// --- Navigation
		// this handler function is called when a line of the product list is clicked. A navigation to the ProductDetail
		// view is started
		onLineItemPressed: function(oEvent) {
			this._oRouter.navTo("ProductDetails", {
				productId: encodeURIComponent(oEvent.getSource().getBindingContext().getProperty("Id"))
			}, false);
		},

		onNavBack: function() {
			var oHistory = sap.ui.core.routing.History.getInstance(),
				sPreviousHash = oHistory.getPreviousHash(),
				oCrossAppNavigator = sap.ushell.Container.getService("CrossApplicationNavigation");
			if (sPreviousHash !== undefined || !oCrossAppNavigator.isInitialNavigation()) {
				oHistory.go(-1);
			} else {
				oCrossAppNavigator.toExternal({
					target: {
						shellHash: "#"
					}
				});
			}
		},

		onShoppingCartChanged: function() {
			this._oHeaderButton.getElementBinding().refresh();
		},

		// enable or disable the buttons of show items and add to cart depending on selected items
		onItemSelected: function() {
			var oItems = this._oCatalog.getSelectedItems();
			if (oItems.length > 0) {
				this.getModel("productListView").setProperty("/hasSelectedItems", true);
				this.getModel("productListView").setProperty("/openLinkText", this._oResourceBundle.getText("xbut.openItemsCount", [oItems.length]));
				this.getModel("productListView").setProperty("/addItemsToCartText", this._oResourceBundle.getText("xbut.addItemsToCartCount", [
					oItems.length
				]));
			} else {
				this.getModel("productListView").setProperty("/hasSelectedItems", false);
				this.getModel("productListView").setProperty("/openLinkText", this._oResourceBundle.getText("xbut.openItems"));
				this.getModel("productListView").setProperty("/addItemsToCartText", this._oResourceBundle.getText("xbut.addToCart"));
			}
		},

		// navigate to the multi product view. Store the Ids of the selected items in a global model, because the tab container filters the products based ont the Ids
		onOpenItemsPressed: function() {
			var oItems = this._oCatalog.getSelectedItems(),
				oFilterModel = this.getModel("filterModel"),
				oModel = this.getModel(),
				aFilters = [];

			for (var i = 0; i < oItems.length; i++) {
				aFilters.push(new Filter("Id", FilterOperator.EQ, oModel.getProperty(oItems[i].getBindingContextPath()).Id));
			}

			oFilterModel.setData(aFilters);
			this._oRouter.navTo("MultiProducts", {}, false);

		},

		// add all selected items to cart, with recursive call of the service "AddProductToShoppingCart"
		onAddItemsToCartPressed: function() {
			this._selectedItems = this._oCatalog.getSelectedItems();
			this._iItem = 0;
			this._sProductIds = "";
			this._addItemsToCartSrv();
		},

		_addItemsToCartSrv: function() {
			this._sProductId = this._selectedItems[this._iItem].getBindingContext().getObject().Id;
			this._iItem++;
			this.getOwnerComponent().getModel().callFunction("/AddProductToShoppingCart", {
				method: "POST",
				urlParameters: {
					ProductId: this._sProductId
				},
				success: this._addToCartSrvSuccess.bind(this),
				error: this.onCartSrvError.bind(this)
			});
		},

		_addToCartSrvSuccess: function(oEvent) {
			if (this._selectedItems.length === 1) {
				this.onCartSrvSuccess();
			} else {
				if (this._iItem < this._selectedItems.length) {
					this._addItemsToCartSrv();
				}
				if (this._iItem === this._selectedItems.length) {
					this._oCatalog.removeSelections();
					this.onItemSelected();
					this._oHeaderButton.getElementBinding().refresh();
					MessageToast.show(this._oResourceBundle.getText("ymsg.addProducts", [this._selectedItems.length]));
				}
			}
		},

		// The personalization service for the product list is created here. It is used to store the following user
		// settings: Visible columns, order of columns
		// The stored settings are applied automatically the next time the app starts.
		_initPersonalization: function() {
			if (sap.ushell.Container) {
				var oPersonalizationService = sap.ushell.Container.getService("Personalization");
				var oPersonalizer = oPersonalizationService.getPersonalizer({
					container: "nw.epm.refapps.shop", // This key must be globally unique (use a key to
					// identify the app) Note that only 40 characters are allowed
					item: "shopProductTable" // Maximum of 40 characters applies to this key as well
				});
				this._oTablePersoController = new TablePersoController({
					table: this._oCatalog,
					componentName: "table",
					persoService: oPersonalizer
				}).activate();
			}
			this.getModel("productListView").setProperty("/personalizationActive", !!sap.ushell.Container);
		},

		//SMARTFILTERBAR methods -------------------------------------------------------------------

		// Reset the filter values to the saved filter values of the variant currently loaded and refresh the product list
		onSFBResetPressed: function() {
			this._oCustomFilter.clearSelection();
			// Retrieve the filter values of the custom control
			this.onSFBVariantLoaded();
			this.onCustomFilterChange();
		},

		// Store the selected filter values of the custom control in the variant
		onSFBVariantSaved: function() {
			var oSelectedFilter = this._oSmartFilterBar.getControlByKey("AverageRating").getSelectedItems(),
				i, aFilterValue = [];

			if (oSelectedFilter) {
				for (i = 0; i < oSelectedFilter.length; i++) {
					aFilterValue.push(oSelectedFilter[i].getKey());
				}
				this._oSmartFilterBar.setFilterData({
					_CUSTOM: {
						AverageRating: aFilterValue
					}
				});
			}
		},

		// Retrieve the filter values of the custom control from the variant and set it to the control
		onSFBVariantLoaded: function() {
			var oCustomFilterData,
				oAverageRatingControl = this._oSmartFilterBar.getControlByKey("AverageRating"),
				oCustomControl = this.byId("averageRatingComboBox");

			if (oAverageRatingControl) {
				if (!this._oFilterData) {
					this._oFilterData = this._oSmartFilterBar.getFilterData();
				}
				oCustomFilterData = this._oFilterData._CUSTOM;
				if (oCustomFilterData) {
					oCustomControl.addSelectedKeys(oCustomFilterData.AverageRating);
				}
			}
			// Load the variant that is flagged as default only once when initially launching the screen
			if (this._bDefaultFilterLoaded) {
				this._bDefaultFilterLoaded = false;
				this.onCustomFilterChange();
			}
		},

		// Execute a search with the selected filter values and refresh the product list.
		// Filter values of a standard control configuration are handled by the control, only filter values of custom
		// controls have to be handled inside this method and passed to $filter of the OData call.
		onSFBFilterChange: function(oEvent) {
			var oSmartFilterBar = oEvent.getSource(),
				oSFBFilters = oSmartFilterBar.getFilterData(),
				aFilterKeys = this._oCustomFilter.getSelectedKeys(),
				i, sFilterOperator;

			this._oTableOperations.resetFilters();
			this._oTableOperations.addSFBFilters(oSFBFilters);

			for (i = 0; i < aFilterKeys.length; i++) {
				if (aFilterKeys[i] === "0") {
					sFilterOperator = FilterOperator.EQ;
				} else {
					sFilterOperator = FilterOperator.GE;
				}

				var oCustomFilter = new Filter("AverageRating", sFilterOperator, aFilterKeys[i]);
				this._oTableOperations.addFilter(oCustomFilter, "AverageRating");
			}
			if (oCustomFilter) {
				this._oTableOperations.applyTableOperations();
			}
		},

		// Execute a search with the selected filter values and refresh the product list.
		// Filter values of a standard control configuration are handled by the control, only filter values of custom
		// controls have to be handled inside this method and passed to $filter of the OData call.
		onCustomFilterChange: function() {
			var oSFBFilters = this._oSmartFilterBar.getFilterData(),
				aFilterKeys = this._oCustomFilter.getSelectedKeys(),
				i, sFilterOperator;

			this._oTableOperations.resetFilters();
			this._oTableOperations.addSFBFilters(oSFBFilters);

			for (i = 0; i < aFilterKeys.length; i++) {
				if (aFilterKeys[i] === "0") {
					sFilterOperator = FilterOperator.EQ;
				} else {
					sFilterOperator = FilterOperator.GE;
				}

				var oCustomFilter = new Filter("AverageRating", sFilterOperator, aFilterKeys[i]);
				this._oTableOperations.addFilter(oCustomFilter, "AverageRating");
			}
			// Increase or decrease the value which is in brackets behind the 'Filter' link depending if a custom filter is selected or not
			if (this._oCustomFilter.getSelectedKeys().length !== 0) {
				this._oCustomFilter.data("hasValue", true);
			} else {
				this._oCustomFilter.data("hasValue", false);
			}

			// Fire the event filterChange to update the value for the 'Filter' link
			this._oSmartFilterBar.fireFilterChange();
		},

		// Handler method for the table search. The actual coding doing the search is outsourced to the reuse library
		// class TableOperations. The search string and the currently active filters and sorters are used to
		// rebind the product list items there. Why rebind instead of update the binding? -> see comments in the helper
		// class
		onSearchPressed: function(oEvent) {
			var sSearchTerm = this._oSmartFilterBar.getBasicSearchControl().getValue();
			this._oTableOperations.setSearchTerm(sSearchTerm);
			this._oTableOperations.applyTableOperations();
		},
		
		// Machine Learning functionality methods  -------------------------------------------------------------------
		
		handleTypeMismatch: function(oEvent) {
			var aFileTypes = oEvent.getSource().getFileType();
			jQuery.each(aFileTypes, function(key, value) {
				aFileTypes[key] = "*." + value;
			});
			var sSupportedFileTypes = aFileTypes.join(", ");
			var msg = this._oResourceBundle.getText("fileTypeMismatch",
				[ oEvent.getParameter("fileType"), sSupportedFileTypes]);
			MessageToast.show(msg);
		},
		
		handleFileSizeExceed: function(oEvent) {
			var msg = this._oResourceBundle.getText("fileSizeExceed",
				[ oEvent.getParameter("fileName"),
				Number.parseFloat(oEvent.getParameter("fileSize")).toFixed(2)]);
			MessageToast.show(msg);
		},

		handleValueChange: function(oEvent) {
			// keep a reference in the view to close it later
			var oBusyDialog = new BusyDialog();
			// start the busy indicator
			oBusyDialog.open();

			var oModel = this.getView().getModel("settings");
			sap.ui.getCore().setModel(oModel, "mlSvc");

			var reader = new FileReader();
			reader.onloadend = function() {
				oModel.setProperty("image", reader.result);
				oModel.refresh();
			};
			
			this.setupModel(oModel);
			if(oEvent.getParameters().files[0] !== undefined) {
				reader.readAsDataURL(oEvent.getParameters().files[0]);
				this.callAPI(oModel.getData(), oEvent.getParameters().files[0], oModel, oBusyDialog);
			} else {
				oBusyDialog.close();
			}
			// clear selection
			var uploader = oEvent.getSource();
			uploader.setValue("");
		},
		
		callAPI: function(oMlSvc, file, oModel, oBusyDialog) {
			var that = this;
			var form = new FormData();
			form.append("files", file);
			if (!(typeof oMlSvc.options === "undefined")) {
				form.append("options", JSON.stringify(oMlSvc.options));
			}
			
			$.ajax({
				url: oMlSvc.url,
				type: "POST",
				headers: oMlSvc.headers,
				data: form,
				processData: false,
				contentType: false,
				success: function(data) {
					try {
						var results = oModel.getProperty("/results");
						for (var j = 0; j < results.length; j++) {
							if (data.predictions[0].results[j].score > 0.01) {
								results[j].score = Math.round(data.predictions[0].results[j].score * 1000) / 10;
							} else {
								results[j].score = Math.round(data.predictions[0].results[j].score * 100000) / 1000;
							}
							var l = data.predictions[0].results[j].label;
							results[j].label = ((l[0] + "").toUpperCase()) + l.substring(1, l.length);
						}
						oModel.setProperty("/results", results);
						oModel.refresh();

						var oListModel = new sap.ui.model.json.JSONModel({
							"ListData": $.map(oModel.getProperty("/results"), 
								function(x) {
									return {
										"title": x.label,
										"description": x.score + "%"
									};
								})
						});
						var item = new sap.m.StandardListItem({
							path: "/",
							title : "{SDList>title}",
						    description: "{SDList>description}",
					    });
					    var oSelectDialog = new SelectDialog({
							"title": that._oResourceBundle.getText("selectAMatch"),
							"cancel": function(oEvent) {
								oBusyDialog.close();
								oSelectDialog.destroy();
								that.doSearch("");
							},
							"confirm": function(oEvent) {
								var oItem = oEvent.getParameters().selectedItem;
								if (oItem) {
									that.doSearch(oItem.getTitle());
								}
								oBusyDialog.close();
								oSelectDialog.destroy();
							}
						});
						oSelectDialog.bindAggregation("items", "SDList>/ListData", item);
						oSelectDialog.setModel(oListModel, "SDList");
						oSelectDialog.open();
					} catch (err) {
						oBusyDialog.close();
						//displays error message
						MessageToast.show("[Caught error] :" + err.message);
					}
				},
				error: function(request, status, error) {
					// console.log(request, status, error);
					oBusyDialog.close();
					//displays error message
					MessageToast.show(that._oResourceBundle.getText("errorProcessingImage"));
					// MessageToast.show("[ajax error] :" + request.responseText + ", " + request.readyState + ", " + request.status + ", " + status + ", " + error);
				}
			});
		},
		
		setupModel: function(oModel) {
			var m = {};
			m.results = [];
			for (var i = 0; i < 5; i++) {
				m.results[i] = {};
				m.results[i].score = [""];
				m.results[i].label = [""];
			}
			oModel.setProperty("/results", m.results);
		},
		
		doSearch: function(sTerm) {
			this._oTableOperations.resetFilters();
			this._oSmartFilterBar.getBasicSearchControl().setValue(sTerm);
			if (!sTerm || sTerm.length < 1) {
				this._oTableOperations.setSearchTerm(sTerm);
			} else {
				var that = this;
				var terms = sTerm.split(/\s|, /);
				var fils = [];
				$.each(["Name", "Id", "Description"], function (ai, attr) {
					$.each(terms, function(si, term) {
						fils.push(new Filter(attr, FilterOperator.Contains, term.toLowerCase()));
						fils.push(new Filter(attr, FilterOperator.Contains, term.toUpperCase()));
						var capitalizedTerm = term.toUpperCase()[0] + term.toLowerCase().substr(1);
						fils.push(new Filter(attr, FilterOperator.Contains, capitalizedTerm));
					});
					that._oTableOperations.addFilter(new Filter({
						filters: fils,
						and: false
					}), attr);
				});
			}
			this._oTableOperations.applyTableOperations();	
		}

	});
});
