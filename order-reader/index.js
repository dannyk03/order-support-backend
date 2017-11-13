'use strict';
const fs = require('fs');
const process = require('process');
const readline = require('readline');
const {Readable} = require('stream');
const {promisify} = require('util');

const _ = require('lodash');

const readFileP = promisify(fs.readFile);

const DEFAULT_RECORD_SEPARATOR = /^_+$/;

function parseDictionary(dictPath) {
  return readFileP(dictionaryPath)
    .then(data => JSON.parse(data));
}

class RequiredOption extends Error {
  constructor(optionName) {
    this.optionName = optionName;
  }
}

function requiredOption(options, name) {
  let val = options[name];
  if (!val) {
    throw new RequiredOption(name);
  }
  return val;
}

/**
 * Split a string by newline chars, and exclude newlines from result.
 */
function splitLines(string) {
  return string.split(/\r?\n/);
}

const FIELD_TYPES = {

  /**
   * A basic value - kept as string, gets trimmed.
   *
   * Options:
   *
   *   field: a string, used as the key for the final key/val pair.
   */
  trimmed: function (opts) {
    let field = requiredOption(opts, 'field');
    return function (obj, header, value) {
      obj[field] = value.trim();
    }
  },

  /**
   * Read a structured table that follows a normal field.
   *
   * The table is assumed to start with a header row.  It gets turned
   * into an Array of objects.
   *
   * Each row in the table is assumed to be printed together, in
   * column order, one column per line. E.g., including the leading
   * value for the normal field:
   *
   *    Community Ensemble
   *    Name
   *    Age
   *    Instrument
   *    Sarah
   *    33
   *    Trumpet
   *    David
   *    31
   *    Viola
   *
   * options:
   *
   *   field_name: name of the normal field
   *
   *   table_name: name of the field that holds the table
   *
   *   num_columns: the number of columns in each table row
   */
  field_followed_by_table: function (opts) {
    let fieldName = requiredOption(opts, 'field_name');
    let tableName = requiredOption(opts, 'table_name');
    let numColumns = requiredOption(opts, 'num_columns');

    return function (obj, header, value) {
      let lines = splitLines(value);

      // Read simple value
      let simpleVal = lines[0].trim();
      obj[fieldName] = simpleVal;

      // Read table
      let tableLines = lines
          .slice(1)  // Ignore simple value
          .map(s => s.trim())
          .filter(s => s !== '');
      if (tableLines.length % numColumns != 0) {
        console.log(trimmedLines);
        throw ('Table ' + header + ' has ' + tableLines.length + ' lines which'
               + " can't cleanly divide " + numColumns + ' columns');
      }
      let numRows = tableLines.length / numColumns - 1;  // take off header row
      let colNames = tableLines.slice(0, numColumns);
      let rows = [];
      for (var i = 0; i < numRows; i++) {
        let rowElems = tableLines.slice((i + 1) * numColumns,
                                        (i + 2) * numColumns);
        let row = _.zipObject(colNames, rowElems);
        rows.push(row);
      }
      obj[tableName] = rows;
    }
  },

  /**
   * Read Primary/Secondary Location *and* the contacts.
   */
  primary_secondary_location: function (opts) {
    let locationField = requiredOption(opts, 'location_field');
    let contactsField = requiredOption(opts, 'contacts_field');

    return function(obj, header, value) {
      let lines = splitLines(value);

      let contacts = [];
      let contactIndex = lines.findIndex(l => /^Contact /.test(l));
      let contactLines = lines.slice(contactIndex)
          .filter(s => s.trim() !== '');
      for (var i = 0; i < contactLines.length; i += 2) {
        let contactNameLine = contactLines[i];
        let contactNameMatch = /^Contact Name (.*)$/.exec(contactNameLine);
        var contactName = null;
        if (contactNameMatch) {
          contactName = contactNameMatch[1];
        }

        let contactPhoneLine = contactLines[i+1];
        var contactPhone = null;
        if (contactPhoneLine) {
          let contactPhoneMatch = /^Telephone (.*)$/.exec(contactPhoneLine);
          if (contactPhoneMatch) {
            contactPhone = contactPhoneMatch[1];
          }
        }

        if (contactName || contactPhone) {
          contacts.push({
            name: contactName,
            phone: contactPhone,
          });
        }
      }

      let secondaryLocationHeader = lines
          .findIndex(s => /^Secondary Location/.test(s));
      let locationLines = lines.slice(secondaryLocationHeader + 1,
                                      contactIndex);
      let location = locationLines.join('\n').trim();

      obj[contactsField] = contacts;
      obj[locationField] = location;
    };
  },
};

class FieldDictionary {
  constructor(data) {
    this.data = data;
  }

  allHeaders() {
    let headers = [];
    Object.values(this.data).forEach(typeDef => {
      Object.values(typeDef.fields || {})
        .forEach(h => headers.push(h));
      Object.keys(typeDef.fields_by_header || {})
        .forEach(h => headers.push(h));
    });

    return headers;
  }

  typesForHeader(header) {
    let types = [];
    Object.entries(this.data).forEach(([typeName, typeDef]) => {
      for (const h of Object.values(typeDef.fields || {})) {
        if (header === h) {
          types.push(typeName);
          return;
        }
      }
      for (const h of Object.keys(typeDef.fields_by_header || {})) {
        if (header == h) {
          types.push(typeName);
          return;
        }
      }
    });
    return types;
  }

  /**
   * Turn a raw header/value pair into fields on obj.
   */
  process(obj, typeName, header, value) {
    if (header == '_meta') {
      obj._meta = value;
      return;
    }
    let typeDef = this.data[typeName];
    for (const [field, h] of Object.entries(typeDef.fields)) {
      if (h === header) {
        let processor = FIELD_TYPES.trimmed({field: field});
        processor(obj, header, value);
        return;
      }
    }
    for (const [h, fieldDef] of Object.entries(typeDef.fields_by_header)) {
      if (h === header) {
        let opts = _.clone(fieldDef);
        delete opts.type;
        let processor = FIELD_TYPES[fieldDef.type](opts);
        processor(obj, header, value);
        return;
      }
    }
    throw ('No processor found in dictionary for header ' + header + ' in '
           + typeName);
  }

  ownerOf(typeName) {
    return this.data[typeName].belongs_to || null;
  }

  get recordSeparator() {
    let sep = this.data.options.record_separator;
    if (sep) {
      return new RegExp(sep);
    } else {
      return DEFAULT_RECORD_SEPARATOR;
    }
  }

  get data() {
    return this._data;
  }

  set data(newData) {
    this._data = _.clone(newData);

    for (const [typeName, typeDef] of Object.entries(this._data)) {
      if (typeName === 'options') {
        continue;
      }
      if (!typeDef.fields_by_header) {
        typeDef.fields_by_header = {};
      }
    };

    if (!this._data.options) {
      this._data.options = {};
    }
  }
}


/**
 * Get an appropriate type na~me for the given set of fields.
 */
function identifyObjectType(rawFields, dictionary) {
  var objectType = null;
  Object.keys(rawFields).forEach(header => {
    var types = dictionary.typesForHeader(header);

    if (!types) {
      console.log('No types for:', header);
      return;
    }

    if (types.length != 1) {
      return;
    }

    let typeName = types[0];
    if (objectType === null) {
      objectType = typeName;
    } else if (objectType !== typeName) {

      // The dictionary specified two fields which are unique to their
      // types, and this object has both of them, meaning the
      // dictionary is wrong or the file is corrupt/invalid.
      throw ('Object can have two or more types: ' + objectType + ' and '
             + typeName + ' due to header ' + header);
    }
  });
  return objectType;
}


/**
 * Take extracted header/value pairs and make a proper object with them.
 */
function cookObject(rawFields, currObjects, dictionary, reverseDictionary) {
  let objectType = identifyObjectType(rawFields, dictionary);
  if (objectType == null) {
    throw 'Object could not be categorized: ' + JSON.stringify(rawFields);
  }

  var result = {};
  Object.entries(rawFields).forEach(([header, value]) => {
    dictionary.process(result, objectType, header, value);
  });

  // Place the object in the right spot
  var owner = dictionary.ownerOf(objectType);
  if (owner) {
    var matchField = owner.match_on;
    var ownerObj = currObjects.find(o => o[matchField] === result[matchField]);
    if (_.isUndefined(ownerObj)) {
      console.log("WARNING: can't find onwer for", matchField,
                  result[matchField], '- discarding data');
    } else {
      if (!ownerObj[owner.as]) {
        ownerObj[owner.as] = [];
      }
      ownerObj[owner.as].push(result);
    }
  } else {
    currObjects.push(result);
  }
}

function allMatches(regexp, s) {
  let results = [];
  var m;
  while (m = regexp.exec(s)) {
    results.push(m);
  }
  return results;
}

class StringRegion {
  constructor(value, isMatch) {
    this.value = value;
    this.isMatch = isMatch;
  }
}

/**
 * Split a string into matched and unmatched regions.
 */
function splitByMatches(regex, string) {
  let matches = allMatches(regex, string);

  let results = [];
  var cursor = 0;
  matches.forEach(match => {
    if (cursor != match.index) {
      results.push(new StringRegion(string.slice(cursor, match.index),
                                    false));
      cursor = match.index;
    }
    results.push(new StringRegion(match[0], true));
    cursor = match.index + match[0].length;
  });

  if (cursor != string.length || results.length == 0) {
    results.push(new StringRegion(string.slice(cursor), false));
  }
  return results;
}

function buildDictionaryRegex(dictionary) {
  let regexTerms = dictionary.allHeaders().map(h => _.escapeRegExp(h));
  let regex = new RegExp(regexTerms.join('|'), 'g');
  return regex;
}


/**
 * I store raw key/value pairs extracted from the input source.
 */
class ObjectBuilder {
  constructor() {
    this.object = {};
  }

  store(field, value) {
    if (this.object[field]) {
      this.warn('ignored_text', ("Repeated value for '" + field
                                 + "', '" + this.object[field] + "'"));
    }
    this.object[field] = value;
  }

  warn(warnType, message) {
    if (!this.object._meta) {
      this.object._meta = {};
    }
    if (!this.object._meta[warnType]) {
      this.object._meta[warnType] = [];
    }
    this.object._meta[warnType].push(message);
  }

  get isEmpty() {
    let keys = Object.keys(this.object);
    return _.isEmpty(keys) || _.isEqual(keys, ['_meta']);
  }
}


class OrderParser {
  constructor(dictionary) {
    this.dictionary = new FieldDictionary(dictionary);
    this.regex = buildDictionaryRegex(this.dictionary);
  }

  parse(text) {

    // FIXME: test string/stream behavior
    var stream;
    if (typeof text === 'string') {
      stream = new Readable();
      stream.push(text);
      stream.push(null);
    } else {
      stream = text;
    }

    let lines = readline.createInterface({input: stream});

    let objects = [];
    var currObject = new ObjectBuilder();

    var multilineField = null;
    function finishMultilineField() {
      currObject.store(multilineField.header, multilineField.value);
      multilineField = null;
    }

    return new Promise((resolve, reject) => {
      lines.on('line', (line) => {
        if (this.dictionary.recordSeparator.exec(line)) {
          if (multilineField) {
            finishMultilineField();
          }
	  if (!currObject.isEmpty) {
            cookObject(currObject.object, objects, this.dictionary);
	  }
          currObject = new ObjectBuilder();
          return;
        }

        if (multilineField) {
          multilineField.value = multilineField.value + '\n';
        }

        let parts = splitByMatches(this.regex, line);
        for (var i = 0; i < parts.length; i++) {
          let part = parts[i];

          // Skip (or accumulate into multiline) unmatched parts
          if (!part.isMatch) {
            if (multilineField) {
              multilineField.value += part.value;
            } else if (part.value.trim() !== '') {
              currObject.warn('ignored_text', ("Ignored header: '"
                                               + part.value + "'"));
            }
            continue;
          }

          // This part matches and a multiline is in progress, that
          // existing multiline has now ended
          if (multilineField) {
            finishMultilineField();
          }

          let header = parts[i].value;

          var value;
          if (parts[i+1]) {
            value = parts[i+1].value;
          } else {
            value = '';
          }

          multilineField = {
            header: header,
            value: value,
          };
          i++;
        }
        if (parts.length == 0 && line.trim() !== '') {
          console.error('Skipping:', line);
        }
      });

      // Show result when reading the file is done
      lines.on('close', () => {
        if (multilineField) {
          finishMultilineField();
        }
        if (!currObject.isEmpty) {
          cookObject(currObject.object, objects, this.dictionary);
        }
        resolve(objects);
      });

    });
  }
};

if (require.main == module) {
  var orderPath = process.argv[2];
  var dictionaryPath = process.argv[3];
  if (!orderPath) {
    console.error('Provide an order file');
    process.exit(1);
  }
  if (!dictionaryPath) {
    console.error('Provide a dictionary file');
    process.exit(1);
  }

  parseDictionary(dictionaryPath)
    .then(dictionaryData => {
      let parser = new OrderParser(dictionaryData);
      return parser.parse(fs.createReadStream(orderPath));
    })
    .then(result => console.log(JSON.stringify(result)))
    .catch(e => console.log(e));
}

exports.OrderParser = OrderParser;
