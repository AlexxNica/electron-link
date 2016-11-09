'use strict'

const assert = require('assert')
const dedent = require('dedent')
const path = require('path')
const recast = require('recast')
const processRequires = require('../../lib/process-requires')

suite('processRequires({source, didFindRequire})', () => {
  test('simple require', () => {
    const source = dedent`
      const a = require('a')
      const b = require('b')
      function main () {
        return a + b
      }
    `
    assert.equal(
      recast.print(processRequires({source, didFindRequire: (mod) => mod === 'a'})).code,
      dedent`
        let a;

        function get_a() {
          return a = a || require('a');
        }

        const b = require('b')
        function main () {
          return get_a() + b
        }
      `
    )
  })

  test('top-level variables assignments that depend on previous requires', () => {
    const source = dedent`
      const a = require('a')
      const b = require('b')
      const c = require('c').c.d
      var e
      e = c.e
      const f = b.f
      function main () {
        c.foo()
        e()
      }
    `
    assert.equal(
      recast.print(processRequires({source, didFindRequire: (mod) => ['a', 'c'].indexOf(mod) >= 0})).code,
      dedent`
        let a;

        function get_a() {
          return a = a || require('a');
        }

        const b = require('b')
        let c;

        function get_c() {
          return c = c || require('c').c.d;
        }

        var e
        function get_e() {
          return e = e || get_c().e;
        };
        const f = b.f
        function main () {
          get_c().foo()
          get_e()()
        }
    `)
  })

  test('top-level usage of deferred modules', () => {
    assert.throws(() => {
      processRequires({source: `var a = require('a'); a()`, didFindRequire: (mod) => true})
    })
    assert.throws(() => {
      processRequires({source: `require('a')()`, didFindRequire: (mod) => true})
    })
  })

  test('requires that appear in a closure wrapper defined in the top-level scope (e.g. CoffeeScript)', () => {
    const source = dedent`
      (function () {
        const a = require('a')
        const b = require('b')
        function main () {
          return a + b
        }
      }).call(this)
    `
    assert.equal(
      recast.print(processRequires({source, didFindRequire: (mod) => mod === 'a'})).code,
      dedent`
        (function () {
          let a;

          function get_a() {
            return a = a || require('a');
          }

          const b = require('b')
          function main () {
            return get_a() + b
          }
        }).call(this)
      `
    )
  })

  test('references to shadowed variables', () => {
    const source = dedent`
      const a = require('a')
      function outer () {
        console.log(a)
        function inner () {
          console.log(a)
        }
        let a = []
      }

      function other () {
        console.log(a)
        function inner () {
          let a = []
          console.log(a)
        }
      }
    `
    assert.equal(
      recast.print(processRequires({source, didFindRequire: (mod) => mod === 'a'})).code,
      dedent`
        let a;

        function get_a() {
          return a = a || require('a');
        }

        function outer () {
          console.log(a)
          function inner () {
            console.log(a)
          }
          let a = []
        }

        function other () {
          console.log(get_a())
          function inner () {
            let a = []
            console.log(a)
          }
        }
      `
    )
  })

  test('path resolution', () => {
    const baseDirPath = path.resolve(__dirname, '..', 'fixtures', 'module')
    const filePath = path.join(baseDirPath, 'dir', 'entry.js')
    const source = dedent`
      const a = require('a')
      const b = require('./subdir/b')
      const c = require('c')
    `
    const requiredModules = []
    assert.equal(
      recast.print(processRequires({baseDirPath, filePath, source, didFindRequire: (mod) => {
        requiredModules.push(mod)
        return true
      }})).code,
      dedent`
        let a;

        function get_a() {
          return a = a || require("./node_modules/a/index.js");
        }

        let b;

        function get_b() {
          return b = b || require("./dir/subdir/b");
        }

        let c;

        function get_c() {
          return c = c || require('c');
        }
      `
    )
    assert.deepEqual(requiredModules, [
      path.join(baseDirPath, 'node_modules', 'a', 'index.js'),
      path.join(baseDirPath, 'dir', 'subdir', 'b'),
      'c'
    ])
  })
})