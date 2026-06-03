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
        const findplaceData = JSON.parse(input).findplace;

        const geometryIds = await getGeometryIds(findplaceData);
        if (!geometryIds.length) return { error: false };

        const polygons = await getPolygons(geometryIds);
        if (!polygons.length) return { error: false };

        return await getAlkisData(findplaceData, polygons[0]);
    } catch (err) {
        return { error: true, message: err.toString() };
    }
}

async function getGeometryIds(findplaceData) {
    const findplaceElements = await getFindplaceElements(findplaceData);

    return findplaceElements.reduce((result, element) => {
        const geometryIds = element.fundplatz_element.lk_geoplugin?.geometry_ids;
        return geometryIds?.length ? result.concat(geometryIds) : result;
    }, []);
}

async function getFindplaceElements(findplaceData) {
    const result = [];

    const key = '_reverse_nested:fundplatz__fundplatz_element:lk_fundplatz';
    if (!findplaceData.fundplatz[key]?.length) return result;
    
    for (entry of findplaceData.fundplatz[key]) {
        const id = entry.lk_fundplatz_element?.fundplatz_element?._id;
        const mask = entry.lk_fundplatz_element?._mask;
        if (id && mask) {
            const findplaceElement = await fetchObject('fundplatz_element', mask, id);
            if (findplaceElement) result.push(findplaceElement);
        }
    }

    return result;
}

async function getPolygons(geometryIds) {
    const geoPluginConfiguration = await getGeoPluginConfiguration();
    const wfsConfiguration = getWfsConfiguration('fundplatz_element', geoPluginConfiguration);
    const authorizationString = getAuthorizationString(geoPluginConfiguration);

    const polygonData = await getPolygonData(geometryIds, wfsConfiguration, authorizationString);
    return polygonData?.map(polygon => polygon.replace(/urn:x-ogc:def:crs:EPSG:/g, 'urn:ogc:def:crs:EPSG::')) ?? [];
}

async function getAlkisData(findplaceData, polygon) {
    switch (getState(findplaceData)) {
        case 'Hamburg':
            return await getHamburgAlkisData(polygon);
        case 'Niedersachsen':
            return await getNiedersachsenAlkisData(polygon);
        default:
            throw 'Missing tag "Hamburg" or "Niedersachsen"';
        }
}

async function getHamburgAlkisData(polygon) {
    const data = await getHamburgAlkisResultForPolygon(polygon);

    return {
        districts: getHamburgDistricts(data),
        plots: getHamburgPlots(data)
    };
}

async function getHamburgAlkisResultForPolygon(polygon) {
    const transactionUrl = 'https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht';

    const requestXml ='<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xmlns:gml="http://www.opengis.net/gml" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="Flurstueck">'
        + '<ogc:Filter>'
        + '<ogc:Intersects>'
        + '<ogc:PropertyName>geometrie</ogc:PropertyName>'
        + polygon
        + '</ogc:Intersects>'
        + '</ogc:Filter>'
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml'
        },
        body: requestXml
    });

    return response.text();
}

function getHamburgDistricts(alkisData) {
    const result = alkisData.matchAll(/<ave:gemarkung>\s*(.+)\s*<\/ave:gemarkung>/g).reduce((result, match) => {
        if (!result.includes(match[1])) result.push(match[1]);
        return result;
    }, []);

    result.sort();

    return result;
}

function getHamburgPlots(alkisData) {
    const numbers = alkisData.matchAll(/<ave:flstnrzae>\s*(\d+)\s*<\/ave:flstnrzae>/g).reduce((result, match) => {
        const number = parseInt(match[1]);
        if (!result.includes(number)) result.push(number);
        return result;
    }, []);

    numbers.sort((a, b) => a - b);

    return numbers;
}

async function getNiedersachsenAlkisData(polygon) {
    const data = await getNiedersachsenAlkisResultForPolygon(polygon);

    return {
        districts: await getNiedersachsenDistricts(data),
        plots: getNiedersachsenPlots(data)
    };
}

async function getNiedersachsenAlkisResultForPolygon(polygon) {
    const transactionUrl = 'https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_sf';

    const requestXml ='<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xmlns:gml="http://www.opengis.net/gml" '
        + 'xmlns:adv="http://www.adv-online.de/namespaces/adv/gid/7.1" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="adv:AX_Flurstueck">'
        + '<ogc:Filter>'
        + '<ogc:Intersects>'
        + '<ogc:PropertyName>adv:position</ogc:PropertyName>'
        + polygon
        + '</ogc:Intersects>'
        + '</ogc:Filter>'
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml'
        },
        body: requestXml
    });

    return response.text();
}

async function getNiedersachsenDistricts(alkisData) {
    const result = [];

    const matches = alkisData.matchAll(/<gemarkungsnummer>\s*(\d+)\s*<\/gemarkungsnummer>/g);
    
    for (let match of matches) {
        const label = await getDistrictLabel(match[1]);
        if (label && !result.includes(label)) result.push(label);
    }

    return result;
}

async function getDistrictLabel(districtNumber) {
    const danteConcept = await getDanteConcept(districtNumber);
    return danteConcept?.prefLabel?.de ?? danteConcept?.prefLabel?.zxx;
}

async function getDanteConcept(districtNumber) {
    const url = 'https://api.dante.gbv.de/data?notation=' + districtNumber;
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) throw response.status;
    
    const concepts = await response.json();

    return concepts.find(concept => concept.uri.includes('nld_gemarkung_niedersachsen'));
}

function getNiedersachsenPlots(alkisData) {
    const result = [];

    const matches = alkisData.matchAll(/<AX_Flurstuecksnummer>([\s\S]+)<\/AX_Flurstuecksnummer>/g);

    for (let match of matches) {
        const content = match[1];
        const zaehler = content.match(/<zaehler>\s*(\d+)\s*<\/zaehler>/)?.[1];
        const nenner = content.match(/<nenner>\s*(\d+)\s*<\/nenner>/)?.[1];
        if (zaehler && nenner) {
            result.push(zaehler + '/' + nenner);
        } else if (zaehler) {
            result.push(zaehler);
        } else if (nenner) {
            result.push(nenner);
        }
    }

    return result;
}

function getState(findplaceData) {
    const configuration = getPluginConfiguration();
    const tagIds = findplaceData._tags.map(tag => tag._id);

    if (tagIds.includes(configuration.hamburg_tag_id)) {
        return 'Hamburg';
    } else if (tagIds.includes(configuration.niedersachsen_tag_id)) {
        return 'Niedersachsen';
    } else {
        return undefined;
    }
}

function getPluginConfiguration() {
    return info.config.plugin.kulturgis.config.kulturgis;
}
