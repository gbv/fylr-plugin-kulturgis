const CollectionPluginKulturGIS = (function(superClass) {
    extend(CollectionPluginKulturGIS, superClass);

    function CollectionPluginKulturGIS() {
        return CollectionPluginKulturGIS.__super__.constructor.apply(this, arguments);
    }

    const Plugin = CollectionPluginKulturGIS.prototype;

    Plugin.getCurrentTools = function(collection) {
        const object = this.__getObject(collection);

        return (object && object._objecttype === 'ensemble')
            ? [this.__getCreateLinksButton(collection, object)]
            : [];   
    };

    Plugin.__getObject = function(collection) {
        let objects;

        try {
            objects = collection.getObjects();
        } catch (err) {
            console.warn('Failed to fetch objects from collection', err);
        }

        return objects?.length === 1
            ? objects[0]?.__object
            : undefined;
    };

    Plugin.__getCreateLinksButton = function(collection, object) {
        return new ToolboxTool({
            group: collection.getToolGroup(),
            name: 'kulturgis-create-links-button',
            sort: 'I:1',
            text: $$('collectionPlugin.kulturgis.createLinksButton'),
            icon: new CUI.Icon({ class: 'fa-link' }),
            favorite: true,
            run: (function(_this) {
                return function() {
                    _this.__createLinks(object);
                };
            })(this)
        });
    };

    Plugin.__createLinks = function(object) {
        const url = ez5.session.data.instance.external_url
            + '/api/v1/plugin/extension/kulturgis/linkEnsembleWithPlaces?access_token='
            + ez5.session.data.access_token;

        const requestData = {
            id: object.ensemble._id,
            mask: object._mask
        };

        const modal = this.__openCreatingLinkModal();
        performPostRequest(url, requestData).then(result => {
            const messageText = this.__getResultMessageText(result); 
            this.__closeModal(modal);
            this.__openMessageModal(messageText);
        }).catch((err) => {
            console.error(err);
            this.__closeModal(modal);
            this.__openMessageModal($$('collectionPlugin.kulturgis.error'));
        });
    };

    Plugin.__getResultMessageText = function(result) {
        if (result.error) return $$('collectionPlugin.kulturgis.error');

        switch (result.linkedFindplaces.length) {
            case 0:
                return $$('collectionPlugin.kulturgis.success.none');
            case 1:
                return $$('collectionPlugin.kulturgis.success.single');
            default:
                return (result.linkedFindplaces.length + ' ' + $$('collectionPlugin.kulturgis.success.multiple'));
        }
    }

    Plugin.__openCreatingLinkModal = function() {
        const modal = new CUI.Modal({
            pane: {
                header_left: new CUI.Label({ text: $$('collectionPlugin.kulturgis.createLinksButton') }),
                content: new CUI.Label({ icon: 'spinner', text: $$('collectionPlugin.kulturgis.creatingLink') })
            }
        });

        modal.autoSize();

        return modal.show();   
    };

    Plugin.__openMessageModal = function(messageText) {
        const modal = new CUI.Modal({
            pane: {
                header_left: new CUI.Label({ text: $$('collectionPlugin.kulturgis.createLinksButton') }),
                content: new CUI.Label({
                    text: messageText,
                    multiline: true
                }),
                footer_right: [
                    new CUI.Button({
                        text: $$('collectionPlugin.kulturgis.ok'),
                        class: 'cui-dialog',
                        primary: true,
                        onClick: () => this.__closeModal(modal)
                    })
                ]
            }
        });

        modal.autoSize();

        return modal.show();
    };

    Plugin.__closeModal = function(modal) {
        modal.hide();
        modal.destroy();
    };

    return CollectionPluginKulturGIS;
})(CollectionPlugin);

ez5.session_ready(function() {
  return Collection.registerPlugin(new CollectionPluginKulturGIS());
});
