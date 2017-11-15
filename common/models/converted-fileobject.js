'use strict';

var converter = require('json-2-csv');


module.exports = function(Convertedfileobject) {
	Convertedfileobject.remoteMethod(
		'downloadtocsv', {
			http: {
				path: '/downloadtocsv/:id',
				verb: 'get'
			},
			return: {},
			accepts: [
				{arg: 'id', type: 'string', required: true },
				{arg: 'res', type: 'object', 'http': {source: 'res'}}
			],
		}
	)

	Convertedfileobject.downloadtocsv = function(id, res, cb) {
		Convertedfileobject.findById(id, {}, function(err, converted_object){
			if(err){
				cb(err)
			}else{
				converter.json2csv(JSON.parse(converted_object.contents), function(err, csv){
					if(err) {
						cb(err)
					}else{
						var dateTime = new Date()
						res.set('Cache-Control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
						res.set('Last-Modified', dateTime +'GMT');
						res.set('Content-Type','application/force-download');
						res.set('Content-Type','application/octet-stream');
						res.set('Content-Type','application/download');
						res.set('Content-Disposition','attachment;filename=Data.csv');
						res.set('Content-Transfer-Encoding','binary');
						res.send(csv); //@todo: insert your CSV data here.				
						// cb(null, contents)						
					}
				});
			}
		})
	}
};
