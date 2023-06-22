process.env.NODE_ENV = 'test'
const config = require('config')
const testUtils = require('@data-fair/processings-test-utils')
const changements = require('../')

describe('test', function () {
  it('try', async function () {
    this.timeout(100000000000)
    const context = testUtils.context({
      pluginConfig: {
      },
      processingConfig: {
        clearFiles: false,
        datasetMode: 'update',
        dataset: {
          title: 'Test communes actuelles',
          id: 'test-communes-actuelles'
        },
        datasetChangementCommune: {
          title: 'Changement de commune',
          id: 'cog-changements'
        },
        datasetInsee: {
          title: 'Code officiel geographique',
          id: 'code-officiel-geographique'
        }
      },
      tmpDir: 'data'
    }, config, false)
    await changements.run(context)
  })
})
