const CustomMaskSplitterAlkis = (function(superClass) {
    extend(CustomMaskSplitterAlkis, superClass);

    function CustomMaskSplitterAlkis() {
        return CustomMaskSplitterAlkis.__super__.constructor.apply(this, arguments);
    }

    const Plugin = CustomMaskSplitterAlkis.prototype;

    Plugin.isSimpleSplit = function() {
        return true;
    }

    Plugin.renderAsField = function() {
        return true;
    }

    Plugin.renderField = function(opts) {
        if (opts.mode !== 'detail' || opts.top_level_data._objecttype !== 'fundplatz') return;

        const rootElement = CUI.dom.div();
        CUI.dom.append(rootElement, this.__renderHeader());

        const loadingIconElement = this.__renderLoadingIcon();
        CUI.dom.append(rootElement, loadingIconElement);
        
        this.__getAlkisData(opts.top_level_data).then(alkisData => {
            CUI.dom.append(rootElement, this.__renderDataLabel(alkisData));
        }).catch(err => {
            console.error(err);
            CUI.dom.append(rootElement, this.__renderDataLabel());
        }).finally(() => {
            CUI.dom.remove(loadingIconElement);
        });

        return rootElement;
    }

    Plugin.__getAlkisData = function(object) {
        const url = ez5.session.data.instance.external_url
            + '/api/v1/plugin/extension/kulturgis/getAlkisData?access_token='
            + ez5.session.data.access_token;

        const requestData = {
            findplace: object
        };

        return performPostRequest(url, requestData);
    };

    Plugin.__renderHeader = function() {
        const headerElement = CUI.dom.div('ez5-field-block-header');
        const titleElement = CUI.dom.div('ez5-field-block-title');
        
        const labelElement = new CUI.Label({ text: $$('custom.mask.splitter.alkis.header'), class: 'ez5-field-label' });

        CUI.dom.append(titleElement, labelElement);
		CUI.dom.append(headerElement, titleElement);

        return headerElement;
    }

    Plugin.__renderLoadingIcon = function() {
        return new CUI.EmptyLabel({
            icon: 'spinner',
            text: $$('custom.mask.splitter.alkis.loading'),
            class: 'alkis-loading-icon'
        });
    };

    Plugin.__renderDataLabel = function(entries) {
        if (entries?.length) {
            const rootElement = CUI.dom.div();
            const texts = entries.map(entry => entry.district + ' ' + entry.plot);
            for (let text of texts) {
                CUI.dom.append(rootElement, new CUI.Label({ text, class: 'alkis-entry-label' }));
            }
            return rootElement;
        } else {
            return new CUI.EmptyLabel({ text: $$('custom.mask.splitter.alkis.noResults') });
        }
    }

    return CustomMaskSplitterAlkis;
})(CustomMaskSplitter);

MaskSplitter.plugins.registerPlugin(CustomMaskSplitterAlkis);
