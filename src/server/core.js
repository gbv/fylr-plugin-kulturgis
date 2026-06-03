async function fetchObject(objectType, mask, id) {
    const url = info.api_url + '/api/v1/db/' + objectType + '/' + mask + '/' + id + '?access_token=' + info.api_user_access_token;

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw 'Failed to fetch object: ' + id;
    const result = await response.json();

    return result?.length
        ? result[0]
        : undefined;
}

async function saveObject(object) {
    const url = info.api_url + '/api/v1/db/' + object._objecttype + '?access_token=' + info.api_user_access_token;

    object[object._objecttype]._version++;

    const response = await fetch(url, { method: 'POST', body: JSON.stringify([object]) });
    if (!response.ok) throw 'Failed to save object';
    return response.json();
}

async function getConfiguration() {
    const url = 'http://fylr.localhost:8082/inspect/config';
    const headers = { 'Accept': 'application/json' };

    return (await fetch(url, { headers })).json();
}

async function getGeoPluginConfiguration() {
    const configuration = await getConfiguration();
    return configuration.BaseConfigList.find(section => section.Name === 'nfisGeoservices').Values;
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

function getAuthorizationString(geoPluginConfiguration) {
    const username = geoPluginConfiguration.geoserver_read_username.ValueText;
    const password = geoPluginConfiguration.geoserver_read_password.ValueText;

    return 'Basic ' + btoa(username + ':' + password);
}

async function getPolygonData(geometryIds, wfsConfiguration, authorizationString) {
    const transactionUrl = wfsConfiguration.wfsUrl + '?service=WFS&version=1.1.0&request=GetFeature';

    const requestXml = '<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="' + wfsConfiguration.featureType + '">'
        + getGeometryIdFilterXml(geometryIds, wfsConfiguration.geometryIdFieldName)
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Authorization': authorizationString
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
