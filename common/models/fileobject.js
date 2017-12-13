'use strict';

module.exports = function(fileobject) {
	fileobject.afterRemote('create', function(context, file_object, next){
		fileobject.app.models.customer.findById(file_object.customer_id, {}, function(err, customer_data){
			file_object["cusotmer"] = customer_data
			context.result = file_object
			next()
		})
	})
};
