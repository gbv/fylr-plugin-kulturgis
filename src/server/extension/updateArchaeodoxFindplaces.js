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
    const configuration = getArchaeodoxConfiguration();
    const requestData = JSON.parse(input);
    const accessToken = await getAccessToken(
        configuration.url,
        configuration.client_id,
        configuration.client_secret,
        configuration.username,
        configuration.password
    );
    
    for (let object of requestData.objects) {
        const result = await processObject(object, configuration.url, accessToken, configuration.tag_pool_mapping);
        return result;
    }
    return { error: false };
}

async function processObject(object, archaeodoxUrl, accessToken, tagPoolMapping) {
    const districtName = await getLinkedDistrictName(object);
    const findplaceNumber = object.fundplatz.fundplatz_id;

    const existingFindplaces = await findExistingFindplaces(archaeodoxUrl, districtName, findplaceNumber, accessToken);
    if (existingFindplaces.length) return;

    const poolId = getPoolId(object, tagPoolMapping);
    if (poolId) return await createFindplaceInArchaeodox(districtName, findplaceNumber, poolId, archaeodoxUrl, accessToken);
}

async function findExistingFindplaces(archaeoDoxUrl, districtName, findplaceNumber, accessToken) {
    const url = archaeoDoxUrl + '/api/v1/search?access_token=' + accessToken;

    const searchRequest = {
        search: [
            {
                type: 'match',
                bool: 'must',
                fields: ['fundplatz.dgis_gemarkung'],
                string: districtName
            },
            {
                type: 'in',
                bool: 'must',
                fields: ['fundplatz.dgis_fundplatznummer'],
                in: [findplaceNumber]
            }
        ]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchRequest)
    });

    if (!response.ok) throw JSON.stringify(await response.json());

    return (await response.json()).objects;
}

function getPoolId(object, tagPoolMapping) {
    const tagIds = object._tags?.map(tag => tag._id) ?? [];

    return tagPoolMapping.find(entry => tagIds.includes(entry.kulturgis_tag_id))
        ?.archaeodox_pool_id;
}

async function createFindplaceInArchaeodox(districtName, findplaceNumber, poolId, archaeodoxUrl, accessToken) {
    const object = buildFindplaceObject(districtName, findplaceNumber, poolId);
    return await saveObject(object, archaeodoxUrl, accessToken);
}

function buildFindplaceObject(districtName, findplaceNumber, poolId) {
    return {
        _objecttype: 'fundplatz',
        _mask: 'fundplatz__all_fields',
        fundplatz: {
            dgis_gemarkung: districtName,
            dgis_fundplatznummer: findplaceNumber,
            _pool: {
                pool: {
                    _id: poolId
                }
            }
        }
    };
}

function getArchaeodoxConfiguration() {
    return info.config.plugin.kulturgis.config.kulturgis_archaeodox;
}
