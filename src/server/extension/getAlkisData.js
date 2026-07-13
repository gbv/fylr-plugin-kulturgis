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

        const geometries = await getGeometries(geometryIds);
        if (!geometries.length) return { error: false };

        return await getAlkisData(findplaceData, geometries);
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

async function getGeometries(geometryIds) {
    const geoPluginConfiguration = await getGeoPluginConfiguration();
    const wfsConfiguration = getWfsConfiguration('fundplatz_element', geoPluginConfiguration);
    const authorizationString = getAuthorizationString(geoPluginConfiguration);

    const geometryData = await getGeometryData(geometryIds, wfsConfiguration, authorizationString);
    return geometryData?.map(geometry => geometry.replace(/urn:x-ogc:def:crs:EPSG:/g, 'urn:ogc:def:crs:EPSG::')) ?? [];
}

async function getAlkisData(findplaceData, geometries) {
    switch (getState(findplaceData)) {
        case 'Hamburg':
            return await getHamburgAlkisData(geometries);
        case 'Niedersachsen':
            return await getNiedersachsenAlkisData(geometries);
        default:
            throw 'Missing tag "Hamburg" or "Niedersachsen"';
        }
}

async function getHamburgAlkisData(geometries) {
    const data = await sendHamburgAlkisRequest(geometries);
    const matches = data.matchAll(/<ave:Flurstueck([\s\S]+?)<\/ave:Flurstueck>/g);

    const result = [];

    for (let match of matches) {
        const entry = {
            district: getHamburgDistrict(match[1]),
            plot: getHamburgPlot(match[1])
        };
        if (entry) result.push(entry);
    }

    sortEntries(result);

    return result;
}

async function sendHamburgAlkisRequest(geometries) {
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
        + getFilter(geometries, 'geometrie')
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

function getHamburgDistrict(data) {
    return data.match(/<ave:gemarkung>\s*(.+)\s*<\/ave:gemarkung>/)?.[1];
}

function getHamburgPlot(data) {
    return data.match(/<ave:flstnrzae>\s*(\d+)\s*<\/ave:flstnrzae>/)?.[1];
}

async function getNiedersachsenAlkisData(geometries) {
    const data = await sendNiedersachsenAlkisRequest(geometries);
    const matches = data.matchAll(/<AX_Flurstueck([\s\S]+?)<\/AX_Flurstueck>/g);

    const result = [];

    for (match of matches) {
        const entry = {
            district: await getNiedersachsenDistrict(match[1]),
            plot: getNiedersachsenPlot(match[1])
        };
        if (entry) result.push(entry);
    }

    sortEntries(result);
    
    return result;
}

async function sendNiedersachsenAlkisRequest(geometries) {
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
        + getFilter(geometries, 'adv:position')
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

async function getNiedersachsenDistrict(data) {
    const districtNumber = data.match(/<gemarkungsnummer>\s*(\d+)\s*<\/gemarkungsnummer>/)?.[1];
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

function getNiedersachsenPlot(data) {
    const result = [];

    const plot = data.match(/<AX_Flurstuecksnummer>([\s\S]+)<\/AX_Flurstuecksnummer>/)?.[1];
    const zaehler = plot.match(/<zaehler>\s*(\d+)\s*<\/zaehler>/)?.[1];
    const nenner = plot.match(/<nenner>\s*(\d+)\s*<\/nenner>/)?.[1];

    return zaehler && nenner
        ? zaehler + '/' + nenner
        : zaehler ?? nenner;
}

function getFilter(geometries, propertyName) {
    return '<ogc:Filter>'
        + (geometries.length > 1 ? '<ogc:Or>' : '')
        + geometries.map(geometry => getIntersectsFilter(geometry, propertyName)).join('')
        + (geometries.length > 1 ? '</ogc:Or>' : '')
        + '</ogc:Filter>';
}

function getIntersectsFilter(geometry, propertyName) {
    return '<ogc:Intersects>'
        + '<ogc:PropertyName>' + propertyName + '</ogc:PropertyName>'
        + geometry
        + '</ogc:Intersects>';
}

function getState(findplaceData) {
    const configuration = getTagsConfiguration();
    const tagIds = findplaceData._tags.map(tag => tag._id);

    if (tagIds.includes(configuration.hamburg_tag_id)) {
        return 'Hamburg';
    } else if (tagIds.includes(configuration.niedersachsen_tag_id)) {
        return 'Niedersachsen';
    } else {
        return undefined;
    }
}

function sortEntries(entries) {
    entries.sort((entry1, entry2) => {
        if (entry1.district < entry2.district) return -1;
        if (entry1.district > entry2.district) return 1;

        const plotNumbers1 = entry1.plot.split('/');
        const zaehler1 = parseInt(plotNumbers1[0]);
        const nenner1 = plotNumbers1.length === 2 ? parseInt(plotNumbers1[1]) : undefined;

        const plotNumbers2 = entry2.plot.split('/');
        const zaehler2 = parseInt(plotNumbers2[0]);
        const nenner2 = plotNumbers2.length === 2 ? parseInt(plotNumbers2[1]) : undefined;

        if (zaehler1 < zaehler2) return -1;
        if (zaehler1 > zaehler2) return 1;

        if (nenner1) {
            if (!nenner2 || nenner1 > nenner2) return 1;
            if (nenner1 < nenner2) return -1;
        }

        if (nenner2) return -1;

        return 0;
    });
}

function getTagsConfiguration() {
    return info.config.plugin.kulturgis.config.kulturgis_tags;
}
