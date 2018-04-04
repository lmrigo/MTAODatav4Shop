sap.ui.define([
	"nw/epm/refapps/shop/controller/BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/ui/generic/app/navigation/service/NavType"
], function(BaseController, JSONModel, NavType) {
	"use strict";

	return BaseController.extend("nw.epm.refapps.shop.controller.App", {

		onInit: function() {
			var oViewModel,
				oFilterModel,
				fnSetAppNotBusy,
				iOriginalBusyDelay = this.getView().getBusyIndicatorDelay();

			oViewModel = new JSONModel({
				busy: true,
				delay: 0
			});
			this.setModel(oViewModel, "appView");

			fnSetAppNotBusy = function() {
				oViewModel.setProperty("/busy", false);
				oViewModel.setProperty("/delay", iOriginalBusyDelay);
			};

			//this.getOwnerComponent().getModel().metadataLoaded().
			//then(fnSetAppNotBusy, fnSetAppNotBusy);
			fnSetAppNotBusy();

			// apply content density mode to root view
			this.getView().addStyleClass(this.getOwnerComponent().getContentDensityClass());

			oFilterModel = new JSONModel({});
			this.setModel(oFilterModel, "filterModel");
		}
	});

});