const path = require('path')
const fs = require('fs-extra')
const jsoncsv = require('json-2-csv')

module.exports = async function (processingConfig, dir, axios, log) {
  let keyInseeComm
  let schemaInseeRef
  try {
    schemaInseeRef = (await axios.get(`api/v1/datasets/${processingConfig.datasetInsee.id}/schema`)).data
  } catch (err) {
    await log.error("Impossible de récupérer le schéma du jeu de données de l'Insee")
  }
  for (const i of schemaInseeRef) {
    if (i['x-refersTo'] === 'http://rdf.insee.fr/def/geo#codeCommune') keyInseeComm = i.key
  }
  if (!keyInseeComm) {
    await log.error(`Le jeu de données "${processingConfig.datasetInsee.title}" ne possède pas le concept requis "Code commune INSEE"`)
  }

  const refCodeInseeComm = []
  let codesCommunes = (await axios.get(`api/v1/datasets/${processingConfig.datasetInsee.id}/lines`, { params: { size: 10000, select: `${keyInseeComm}` } })).data
  refCodeInseeComm.push(...codesCommunes.results)
  while (codesCommunes.results.length === 10000) {
    codesCommunes = (await axios.get(codesCommunes.next)).data
    refCodeInseeComm.push(...codesCommunes.results)
  }
  const changement = []
  const points = []
  try {
    let changes = (await axios.get(`api/v1/datasets/${processingConfig.datasetChangementCommune.id}/lines?format=json`, { params: { size: 10000 } })).data

    for (const elem of changes.results) {
      if (changement[elem.COM_AV]) {
        let test = false
        for (const com of changement[elem.COM_AV]) {
          if (com[0] === elem.COM_AP) {
            test = true
            if (com[1] < elem.DATE_EFF) {
              changement[elem.COM_AV] = [[elem.COM_AP, elem.DATE_EFF]]
            }
          }
        }
        if (!test) {
          changement[elem.COM_AV].push([elem.COM_AP, elem.DATE_EFF])
        }
      } else {
        changement[elem.COM_AV] = [[elem.COM_AP, elem.DATE_EFF]]
      }
      if (!points.includes(elem.COM_AV)) points.push(elem.COM_AV)
    }
    while (changes.results.length === 10000) {
      changes = (await axios.get(changes.next)).data
      for (const elem of changes.results) {
        if (changement[elem.COM_AV]) {
          let test = false
          for (const com of changement[elem.COM_AV]) {
            if (com[0] === elem.COM_AP) {
              test = true
              if (com[1] < elem.DATE_EFF) {
                changement[elem.COM_AV] = [[elem.COM_AP, elem.DATE_EFF]]
              }
            }
          }
          if (!test) {
            changement[elem.COM_AV].push([elem.COM_AP, elem.DATE_EFF])
          }
        } else {
          changement[elem.COM_AV] = [[elem.COM_AP, elem.DATE_EFF]]
        }
        if (!points.includes(elem.COM_AV)) points.push(elem.COM_AV)
      }
    }
  } catch (err) {
    await log.error('Impossible de récupérer les changements de communes')
  }

  const chemins = {}
  function retracerChemin (numero, cheminActuel) {
    if (changement[numero]) {
      // Retrieve the changes associated with this number
      const changements = changement[numero]
      let test = true
      for (const change of cheminActuel) {
        if (changements.length > 1) {
          const firstChange = changements[0]
          if (change[0] === firstChange[0]) {
            test = false
            if (new Date(change[1]) < new Date(firstChange[1])) {
              cheminActuel = [...cheminActuel, [firstChange[0], firstChange[1]]]
              chemins[cheminActuel[0][0]] = cheminActuel
            } else {
              chemins[cheminActuel[0][0]] = cheminActuel
            }
          }
        } else {
          if (change[0] === changements[0]) {
            test = false
            if (new Date(change[1]) < new Date(changements[1])) {
              cheminActuel = [...cheminActuel, [changements[0], changements[1]]]
              chemins[cheminActuel[0][0]] = cheminActuel
            } else {
              chemins[cheminActuel[0][0]] = cheminActuel
            }
          }
        }
      }
      if (test) {
        if (changements.length > 1) {
          // Check if the dates of the changes are similar
          const datesSimilaires = changements.every(([_, date], index, arr) => date === arr[0][1])// could be improved (works for most cases) as it is possible that other changes have taken place without it being the split (so not at the same date)
          if (datesSimilaires) {
            const max = changements[0][0]
            const maxDate = changements[0][1]
            // improve and choose the most populous commune
            const nouveauChemin = [...cheminActuel, [max, maxDate]]
            retracerChemin(max, nouveauChemin)
          } else {
            // General case (different dates): keep the latest change
            const dernierChangement = changements[0]
            const [nouveauNumero, date] = dernierChangement
            const nouveauChemin = [...cheminActuel, [nouveauNumero, date]]
            retracerChemin(nouveauNumero, nouveauChemin)
          }
        } else {
          let testPass = false
          if (cheminActuel[cheminActuel.length - 1][1] === '') testPass = true
          if ((new Date(cheminActuel[cheminActuel.length - 1][1]) < new Date(changements[0][1])) || testPass) {
            const dernierChangement = changements[0]
            const [nouveauNumero, date] = dernierChangement
            const nouveauChemin = [...cheminActuel, [nouveauNumero, date]]
            retracerChemin(nouveauNumero, nouveauChemin)
          } else {
            chemins[cheminActuel[0][0]] = cheminActuel
          }
        }
      }
    } else {
      // The current number has no changes, so it is the final current number
      chemins[cheminActuel[0][0]] = cheminActuel
    }
  }
  for (const pt of points) {
    retracerChemin(pt, [[pt, '']])
  }
  // allows to go through the changes until you get a city that currently exists
  for (const change of Object.keys(chemins)) {
    const changeTab = chemins[change]
    let test = false
    const newChange = []
    while (test === false && changeTab[0]) {
      for (const com of refCodeInseeComm) {
        if (com.code_commune === changeTab[0][0]) {
          test = true
        }
      }
      if (!test) {
        newChange.push(changeTab[0])
        changeTab.shift()
      } else {
        newChange.push(changeTab[0])
      }
    }
    chemins[change] = newChange.length > 1 ? newChange[newChange.length - 1][0] : []
    // eslint-disable-next-line no-unused-expressions
    chemins[change][0] ? null : delete chemins[change]
  }

  const changementsObjet = []
  for (const changement in chemins) {
    changementsObjet.push({ COM_AV: changement.padStart(5, 0), COM_AP: chemins[changement].padStart(5, 0) })
  }

  const filePath = path.join(dir, 'changementsCommunes.csv')
  const csv = await jsoncsv.json2csv(changementsObjet)
  await fs.ensureFileSync(filePath)
  await fs.writeFile(filePath, csv)
}
