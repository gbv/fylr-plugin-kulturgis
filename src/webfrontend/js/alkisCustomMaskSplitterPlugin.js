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
        const districtsElement = CUI.dom.div('alkis-districts');
        const plotsElement = CUI.dom.div();

        CUI.dom.append(rootElement, districtsElement);
        CUI.dom.append(rootElement, plotsElement);

        CUI.dom.append(districtsElement, this.__renderHeader($$('custom.mask.splitter.alkis.header.districts')));
        CUI.dom.append(plotsElement, this.__renderHeader($$('custom.mask.splitter.alkis.header.plots')));

        const districtsContentElement = CUI.dom.div('ez5-field-block-content');
        CUI.dom.append(districtsElement, districtsContentElement);

        const plotsContentElement = CUI.dom.div('ez5-field-block-content');
        CUI.dom.append(plotsElement, plotsContentElement);

        const districtsLoadingIconElement = this.__renderLoadingIcon();
        CUI.dom.append(districtsContentElement, districtsLoadingIconElement);

        const plotsLoadingIconElement = this.__renderLoadingIcon();
        CUI.dom.append(plotsContentElement, plotsLoadingIconElement);
        
        this.__getAlkisData(opts.top_level_data).then(alkisData => {
            CUI.dom.append(districtsContentElement, this.__renderDataLabel(alkisData.districts));
            CUI.dom.append(plotsContentElement, this.__renderDataLabel(alkisData.plots));
        }).catch(err => {
            console.error(err);
            CUI.dom.append(districtsContentElement, this.__renderDataLabel());
            CUI.dom.append(plotsContentElement, this.__renderDataLabel());
        }).finally(() => {
            CUI.dom.remove(districtsLoadingIconElement);
            CUI.dom.remove(plotsLoadingIconElement);
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

    Plugin.__renderHeader = function(text) {
        const headerElement = CUI.dom.div('ez5-field-block-header');
        const titleElement = CUI.dom.div('ez5-field-block-title');
        
        const labelElement = new CUI.Label({ text, class: 'ez5-field-label' });

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
            for (let entry of entries) {
                CUI.dom.append(rootElement, new CUI.Label({ text: entry, class: 'alkis-entry-label' }));
            }
            return rootElement;
        } else {
            return new CUI.EmptyLabel({ text: $$('custom.mask.splitter.alkis.noResults') });
        }
    }

    return CustomMaskSplitterAlkis;
})(CustomMaskSplitter);

MaskSplitter.plugins.registerPlugin(CustomMaskSplitterAlkis);
