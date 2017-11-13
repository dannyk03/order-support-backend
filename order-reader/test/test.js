'use strict';

const assert = require('assert');
const chai = require('chai');
const {OrderParser} = require('..');

chai.should();

describe('OrderParser', () => {
  describe('#parse', () => {
    it('should parse simple fields', () => {
      return Promise.resolve().then(() => {
        let parser = new OrderParser({
          Order: {
            fields: {
              "foo": "Foo: ",
            }
          }
        });
        return parser.parse('Foo: 3');
      }).then(result => {
        result.should.eql(
          [{foo: '3'}]
        );

        let otherParser = new OrderParser({
          Order: {
            fields: {
              "fizz": "Fizz  : ",
              "buzz": "buz:",
            }
          }
        });

        return otherParser.parse('buz: one\nFizz  : two')
      }).then(result => {
        result.should.eql(
          [{'fizz': 'two', 'buzz': 'one'}]
        );
      });
    });

    it('should parse multiline fields', () => {
      let parser = new OrderParser({Order: {
        fields: {
          "foo": "Foo:",
        }
      }});

      return parser.parse('Foo:\nLine 1\nLine 2\nLine 3\n').then(result => {
        result.should.eql(
          [{'foo': 'Line 1\nLine 2\nLine 3'}]
        );

        let parser2 = new OrderParser({Order: {
          fields: {
            "fizz": "Fizz:",
            "buzz": "Buzz:",
          }
        }});

        let data = 'Fizz: Line 1\nLine 2\n  Buzz:\nLine 3\nLine 4';
        return parser2.parse(data);
      }).then(result => {
        result.should.eql(
          [{fizz: 'Line 1\nLine 2', buzz: 'Line 3\nLine 4'}]
        );
      });
    });

    it('should parse multiple objects separated by underscores', () => {
      let parser = new OrderParser({Order: {
        fields: {
          foo: "Foo:"
        }
      }});

      let data = 'Foo: 1\n____\nFoo: 2\n_____\nFoo: 3'
      return parser.parse(data).then(result => {
        result.should.eql(
          [{foo: '1'},
           {foo: '2'},
           {foo: '3'}]
        );
      });
    });

    it('allows a custom record separator', () => {
      let parser = new OrderParser({
        options: {
          record_separator: "^---$"
        },
        Order: { fields: { foo: "Foo:" }}
      });

      // Note: First 3 'fields' don't have a valid separator
      let data = 'Foo: 1\n---\nFoo: 2\n---\nFoo: 3'
      return parser.parse(data).then(result => {
        result.should.eql(
          [{foo: '1'},
           {foo: '2'},
           {foo: '3'}]
        );
      });
    });

    it('attaches warning messages on ignored text', () => {
      let parser = new OrderParser({Order: {fields: {foo: "Foo:"}}});
      let data = 'Hello there\nFoo: 1\n___\nNot in a field\nFoo: 2';

      return parser.parse(data).then(result => {

        result.should.eql(
          [
            {
              foo: '1',
              _meta: {
                ignored_text: [
                  "Ignored header: 'Hello there'",
                ]
              }
            },
            {
              foo: '2',
              _meta: {
                ignored_text: [
                  "Ignored header: 'Not in a field'",
                ]
              },
            }
          ]);
      });
    });

    it('warns when a field is repeated for the same object', () => {
      let parser = new OrderParser({Order: {fields: {foo: 'Foo:'}}});
      let data = 'Foo: 1\nFoo: 2\n____\nFoo: 3\n___\nFoo: 4\nFoo: 5';

      return parser.parse(data).then(result => {

        result.should.eql(
          [
            {
              foo: '2',
              _meta: {
                ignored_text: [
                  "Repeated value for 'Foo:', ' 1\n'"
                ]
              }
            },
            {foo: '3'},
            {
              foo: '5',
              _meta: {
                ignored_text: [
                  "Repeated value for 'Foo:', ' 4\n'"
                ]
              }
            }
          ]
        );
      });
    });

    it('allows objects to belong to other objects', () => {
      let parser = new OrderParser({
        Order: {fields: {foo: 'Foo:'}},
        Suborder: {fields: {foo: 'foo:',
                            bar: 'bar:'},
                   belongs_to: {by: 'foo',
                                as: 'suborders'}}
      });
      let data = 'Foo: 1\n__\nfoo: 1\nbar: hello'

      parser.parse(data).then(result => {
        result.should.eql(
          [{foo: '1',
            suborders: [{foo: '1', bar: 'hello'}]}]
        );
      });
    });

    it('ignores objects with only ignored text', () => {
      let parser = new OrderParser({
        Order: {fields: {foo: 'Foo:'}},
      });
      let data = 'Nothing in here\n__\nNothing here either'

      parser.parse(data).then(result => {
        result.should.eql([]);
      });      
    });
  });
});
