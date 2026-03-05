const info = process.argv.length >= 3
    ? JSON.parse(process.argv[2])
    : {};

let input = '';

process.stdin.on('data', d => {
    try {
        input += d.toString();
    } catch (e) {
        console.error(`Could not read input into string: ${e.message}`, e.stack);
        process.exit(1);
    }
});

process.stdin.on('end', async () => {
    const result = await handleRequest();
    console.log(JSON.stringify(result, null, 2));
});

async function handleRequest() {
    try {
        const geoPluginConfiguration = await getGeoPluginConfiguration();
        const ensemble = await getEnsemble();
        const findplaces = await getFindplaces(ensemble, geoPluginConfiguration);
        const success = await linkFindplacesWithEnsemble(ensemble, findplaces);

        return {
            linkedFindplaces: success ? findplaces : [],
            error: !success
        };
    } catch {
        return { error: true };
    }
}

async function getEnsemble() {
    const requestBody = JSON.parse(input);
    const id = requestBody?.id;
    if (!id) return undefined;

    const mask = requestBody?.mask;
    if (!mask) return undefined;

    return fetchObject('ensemble', mask, id);
}

async function getFindplaces(ensemble, geoPluginConfiguration) {
    const ensembleElements = await getEnsembleElements(ensemble);
    const ensembleGeometryIds = getGeometryIds(ensembleElements);
    const ensemblePolygons = await getEnsemblePolygons(ensembleGeometryIds, geoPluginConfiguration);
    const findplaceGeometryIds = await getFindplaceGeometryIds(ensemblePolygons, geoPluginConfiguration);
    const findplaceElements = await getFindplaceElements(findplaceGeometryIds);
    return getLinkedFindplaces(findplaceElements);
}

async function getEnsembleElements(ensemble) {
    const result = [];

    for (let entry of ensemble.ensemble['_reverse_nested:ensemble__ensemble_element:lk_ensemble']) {
        const id = entry.lk_ensemble_element.ensemble_element._id;
        const mask = entry.lk_ensemble_element._mask;
        result.push(await fetchObject('ensemble_element', mask, id));
    }

    return result;
}

function getGeometryIds(ensembleElements) {
    return ensembleElements.reduce((result, element) => {
        const geometryIds = element.ensemble_element.lk_geoplugin?.geometry_ids;
        if (geometryIds?.length) result = result.concat(geometryIds);
        return result;
    }, []);
}

async function getEnsemblePolygons(geometryIds, geoPluginConfiguration) {
    const { wfsUrl, featureType, geometryIdFieldName } = getWfsConfiguration('ensemble_element', geoPluginConfiguration);
    const transactionUrl = wfsUrl + '?service=WFS&version=1.1.0&request=GetFeature';

    const requestXml = '<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="' + featureType + '">'
        + getGeometryIdFilterXml(geometryIds, geometryIdFieldName)
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Authorization': getAuthorizationString(geoPluginConfiguration)
        },
        body: requestXml
    });

    return getPolygonsFromXml(await response.text());
}

function getGeometryIdFilterXml(geometryIds, geometryIdFieldName) {
    return '<ogc:Filter>'
        + (geometryIds.length === 1
            ? getGeometryIdFilterElementXml(geometryIdFieldName)(geometryIds[0])
            : '<ogc:Or>' + geometryIds.map(getGeometryIdFilterElementXml(geometryIdFieldName)).join('') + '</ogc:Or>'
        )
        + '</ogc:Filter>';
}

function getGeometryIdFilterElementXml(geometryIdFieldName) {
    return function(geometryId) {
        return '<ogc:PropertyIsEqualTo>'
            + '<ogc:PropertyName>' + geometryIdFieldName + '</ogc:PropertyName>'
            + '<ogc:Literal>' + geometryId + '</ogc:Literal>'
            + '</ogc:PropertyIsEqualTo>';
    }
}

function getPolygonsFromXml(xml) {
    return xml.match(/<gml:Polygon[\s\S]*?<\/gml:Polygon>/g);
}

async function getFindplaceGeometryIds(ensemblePolygons, geoPluginConfiguration) {
    let geometryIds = [];

    for (let ensemblePolygon of ensemblePolygons) {
        geometryIds = geometryIds.concat(
            await getFindplaceGeometryIdsForPolygon(ensemblePolygon, geoPluginConfiguration)
        );
    }

    return geometryIds;
}

async function getFindplaceGeometryIdsForPolygon(ensemblePolygon, geoPluginConfiguration) {
    const { wfsUrl, featureType } = getWfsConfiguration('fundplatz_element', geoPluginConfiguration);
    const transactionUrl = wfsUrl + '?service=WFS&version=1.1.0&request=GetFeature';

    const requestXml ='<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xmlns:gml="http://www.opengis.net/gml" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="' + featureType + '">'
        + '<ogc:Filter>'
        + '<ogc:Intersects>'
        + '<ogc:PropertyName>geom</ogc:PropertyName>'
        + ensemblePolygon
        + '</ogc:Intersects>'
        + '</ogc:Filter>'
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Authorization': getAuthorizationString(geoPluginConfiguration)
        },
        body: requestXml
    });

    return getGeometryIdsFromXml(await response.text());
}

function getGeometryIdsFromXml(xml) {
    return xml.match(/<kulturgis:uuid>([\s\S]*?)<\/kulturgis:uuid>/g).map(geometryId => {
        return geometryId.replace('<kulturgis:uuid>', '').replace('</kulturgis:uuid>', '');
    })
}

async function getFindplaceElements(geometryIds) {
    const url = info.api_url + '/api/v1/search?access_token=' + info.api_user_access_token;

    const searchRequest = {
        search: geometryIds.map(geometryId => {
            return {
                type: 'match',
                bool: 'should',
                fields: ['fundplatz_element.lk_geoplugin.geometry_ids'],
                string: geometryId
            };
        })
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchRequest)
    });

    return (await response.json()).objects;
}

async function getLinkedFindplaces(findplaceElements) {
    const result = [];
    const ids = [];

    for (let findplaceElement of findplaceElements) {
        for (let entry of findplaceElement.fundplatz_element['_reverse_nested:fundplatz__fundplatz_element:lk_fundplatz_element']) {
            const id = entry.lk_fundplatz.fundplatz._id;
            if (ids.includes(id)) continue;
            const mask = entry.lk_fundplatz._mask;
            result.push(await fetchObject('fundplatz', mask, id));
            ids.push(id);
        }
    }

    return result;
}

async function linkFindplacesWithEnsemble(ensemble, findplaces) {
    const editedEnsemble = {
        ensemble: ensemble.ensemble,
        _mask: ensemble._mask,
        _objecttype: 'ensemble',
        _tags: ensemble._tags
    };

    const findplaceLinks = findplaces.map(findplace => {
        return {
            _version: 1,
            lk_fundplatz: {
                fundplatz: {
                    _id: findplace.fundplatz._id
                },
                _mask: findplace._mask,
                _objecttype: 'fundplatz',
                _global_object_id: findplace._global_object_id
            }
        };
    })

    const fieldName = '_reverse_nested:ensemble__fundplatz:lk_ensemble';
    editedEnsemble.ensemble[fieldName] = (editedEnsemble.ensemble[fieldName] ?? []).concat(findplaceLinks);

    return (await saveObject(editedEnsemble))?.length === 1;
}

function getWfsConfiguration(objectType, geoPluginConfiguration) {
    const fieldConfiguration = geoPluginConfiguration.wfs_configuration.ValueTable
        .find(element => element.object_type.ValueText === objectType)
        ?.geometry_fields?.ValueTable.find(field => field.field_path?.ValueText === 'lk_geoplugin');
    
    return {
        wfsUrl: fieldConfiguration.display_wfs_url.ValueText,
        featureType: fieldConfiguration.display_wfs_feature_type.ValueText,
        geometryIdFieldName: geoPluginConfiguration.wfs_geometry_id_field_name.ValueText
    };
}

async function getGeoPluginConfiguration() {
    const configuration = await getConfiguration();
    return configuration.BaseConfigList.find(section => section.Name === 'nfisGeoservices').Values;
}

function getAuthorizationString(geoPluginConfiguration) {
    const username = geoPluginConfiguration.geoserver_read_username.ValueText;
    const password = geoPluginConfiguration.geoserver_read_password.ValueText;

    return 'Basic ' + btoa(username + ':' + password);
}

async function getConfiguration() {
    const url = 'http://fylr.localhost:8082/inspect/config';
    const headers = { 'Accept': 'application/json' };

    return (await fetch(url, { headers })).json();
}

async function fetchObject(objectType, mask, id) {
    const url = info.api_url + '/api/v1/db/' + objectType + '/' + mask + '/' + id + '?access_token=' + info.api_user_access_token;

    const response = await fetch(url, { method: 'GET' });
    const result = await response.json();

    return result?.length
        ? result[0]
        : undefined;
}

async function saveObject(object) {
    const url = info.api_url + '/api/v1/db/' + object._objecttype + '?access_token=' + info.api_user_access_token;

    object[object._objecttype]._version++;

    const response = await fetch(url, { method: 'POST', body: JSON.stringify([object]) });
    return response.json();
}
