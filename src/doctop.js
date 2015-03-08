/*
 * Doctop — consume Google Docs via jQuery
 *
 * Copyright (c) 2014 Ændrew Rininsland, The Times and Sunday Times
 * Licensed under the MIT license.
 *
 * TODO Ermahgerd, why did I not comment this better? (Æ, 2015.03.09)
 */

(function ($) {

  // Static method.
  $.doctop = function (options) {
    // Override default options with passed-in options.
    this.options = $.extend({}, $.doctop.options, options);

    this._parseAndCleanDOM = function(res) {
      var root;
      if (this.options.staticExport) {
        root = $(res)
                .not('meta')
                .not('style')
                .not('title');
      } else {
        root = $(res)
        .filter('#contents')
        .children()
        .not('style'); // Don't need no stylesheets hurr!
      }

      if (this.options.archieml && typeof window.archieml === 'object') { // Parse according to ArchieML rules
        // Modified from: https://github.com/newsdev/archieml-js/blob/master/examples/google_drive.js
        var tagHandlers = {
          _base: function (tag) {
            var str = '', func;
            if (typeof tag.tagName !== 'undefined') {
              if (tag.children.length) {
                $.each(tag.children, function(i, child) {
                  if (func = tagHandlers[child.tagName.toLowerCase()]){
                    str += func(child);
                  }
                });
              } else {
                str += $(tag).text();
              }

            } else { // top level
              tag.each(function(i, child) {
                if (func = tagHandlers[child.tagName.toLowerCase()]) {
                  str += func(child);
                }
              });
            }

            return str;
          },
          text: function (textTag) {
            return $(textTag).text();
          },
          span: function (spanTag) {
            return tagHandlers._base(spanTag);
          },
          p: function (pTag) {
            return tagHandlers._base(pTag) + '\n';
          },
          a: function (aTag) {
            var href = $(aTag).attr('href');
            if (href === undefined) {
              return '';
            }

            // extract real URLs from Google's tracking
            // from: http://www.google.com/url?q=http%3A%2F%2Fwww.nytimes.com...
            // to: http://www.nytimes.com...
            if (href && aTag.search.indexOf('?q=') > -1) {
              href = aTag.search.substr(aTag.search.indexOf('q=') + 2, aTag.search.indexOf('&') > - 1 ? aTag.search.indexOf('&') - 3 : undefined);
              href = decodeURIComponent(href);
            }

            var str = '<a href="' + href + '">';
            str += $(aTag).text(); //TODO //tagHandlers._base(aTag);
            str += '</a>';

            return str;
          },
          li: function (tag) {
            return '* ' + tagHandlers._base(tag) + '\n';
          }
        };

        ['ul', 'ol'].forEach(function(tag) {
          tagHandlers[tag] = tagHandlers.span;
        });

        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function(tag) {
          tagHandlers[tag] = tagHandlers.p;
        });

        return tagHandlers._base(root);
      } else {
        // Replace spans with proper <strong> and <em> elements.
        if (this.options.preserveFormatting || this.options.fancyOutput) {
          var textStyles = this.options.staticExport ? $(res).filter('style')[0].innerHTML : $(res).filter('#contents').children('style')[0].innerHTML;
          var boldClass = /(\.[a-z0-9]+?)\{[^{}]*?font-weight:bold[^{}]*?\}/gi.exec(textStyles);
          var italicClass = /(\.[a-z0-9]+?)\{[^{}]*?font-style:italic[^{}]*?\}/gi.exec(textStyles);
          if (boldClass && boldClass.length > 0) {
            root.find('span' + boldClass[1]).each(function(i, v){
              $(v).replaceWith('<strong>'  + v.innerHTML + '</strong>');
            });
          }

          if (italicClass && italicClass.length >  0) {
            root.find('span' + italicClass[1]).each(function(i, v){
              $(v).replaceWith('<em>' + v.innerHTML + '</em>');
            });
          }
        }

        // Strip out all the stupid class-less <span> tags
        $.grep(root.find('span'), function(v){
          if ($(v).text().length > 0) {
            $(v).replaceWith(v.innerHTML);
            return true;
          }
        });

        // Remove &nbsp; and Unicode 160
        root.each(function(i, v){
          v.innerHTML = v.innerHTML.replace(/(?:\x0A|&nbsp;)/gi, ' ');
        });

        return root;
      }
    };

    this._parseDOMIntoTree = function(root) {
      var options = this.options;

      var _returnNode = function(tree, node) {
        if (options.fancyOutput) {
          return {
            index: Object.keys(tree).length,
            content: node.textContent.trim(),
            children: {}
          };
        } else {
          return {};
        }
      };

      var _returnParagraph = function(node, currentTree) {
        if (options.fancyOutput) {
          return {
            content: $(node).text(),
            content_html: node.innerHTML,
            index: Object.keys(currentTree).length
          };
        } else if (options.preserveFormatting) {
          return node.innerHTML;
        } else {
          return $(node).text();
        }
      };

      var _enumerateKey = function(key, tree) {
        var i = 0;
        while (typeof tree[key] !== 'undefined') {
          key = key + '_' + i;
          i++;
        }

        return key;
      };

      // Begin the main DOM walker!

      var tree = {};
      var currentTree = tree;
      var currentLevel = 1;
      var i = 0;
      var node = root[0];
      var tagName, key, lastTree;
      while (node && node.nodeType === 1) {
        tagName = node.tagName.toLowerCase();

        // Handle headers
        switch(tagName) {
          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6':
            key = options.simpleKeys ? tagName + '_' + i : getSlug(node.textContent.trim(), {separator: '_'});
            if (tagName === 'h1') { // is top level
              key = _enumerateKey(key, tree);
              tree[key] = _returnNode(tree, node);
              currentTree = options.fancyOutput ? tree[key].children : tree[key];
              lastTree = currentTree;
            } else {
              if (currentLevel >= Number(tagName.substr(1))) { // go up a level; same level
                key = _enumerateKey(key, lastTree);
                lastTree[key] = _returnNode(lastTree, node);
                currentTree = options.fancyOutput ? lastTree[key].children : lastTree[key];
              } else if (currentLevel < Number(tagName.substr(1))){ // go down a level
                key = _enumerateKey(key, currentTree);
                currentTree[key] = _returnNode(currentTree, node);
                currentTree = options.fancyOutput ? currentTree[key].children : currentTree[key];
              }
            }

            currentLevel = Number(tagName.substr(1)); // assign currentLevel to the level of the current tag.
          break;

          // Handle paragraphs
          default:
            if (node.innerHTML !== '<span></span>') {
              i = Object.keys(currentTree).length > 0 ? Object.keys(currentTree).length : 0;
              key = tagName + '_' + i;
              currentTree[key] = _returnParagraph(node, currentTree);
            }
          break;
        } //end switch

        // Move to the next element
        node = node.nextElementSibling;
      } // end while

      return tree;
    }; // end this._parseDOMIntoTree

    this._doCallbacks = function(tree) {
      // Add Tabletop to output if requested
      if (typeof this.options.tabletop_url !== 'undefined' && typeof Tabletop !== 'undefined') {
        var tabletopData = new $.Deferred();
        Tabletop.init({
          key: this.options.tabletop_url,
          simpleSheet: this.options.tabletop_simplesheet,
          proxy: this.options.tabletop_proxy,
          callback: function(data, tt) {
            tabletopData.resolve({data: data, tabletop: tt});
          }
        });

        $.when(tabletopData).done($.proxy(function(ttdata){
          this.options.callback.call(tree, {copy: tree, data: ttdata});
        }, this));

      // Otherwise return tree
      } else {
        this.options.callback.call(tree, {copy: tree});
      }
    };

    // Main Constructor AJAX call
    $.ajax({
      context: this,
      url: this.options.url,
      type: 'GET',
      cache: this.options.cache,
      crossDomain: true,
      success: function(res) {
        var root = this._parseAndCleanDOM(res);
        var tree;
        if (this.options.archieml && typeof window.archieml === 'object') {
          // Remove smart quotes from inside tags
          root = root.replace(/<[^<>]*>/g, function(match){
            return match.replace(/”|“/g, '"').replace(/‘|’/g, "'");
          });
          tree = archieml.load(root);
        } else {
          tree = this._parseDOMIntoTree(root);
        }
        this._doCallbacks(tree);
      }
    });


  }; // end $.doctop

  // Static method default options.
  $.doctop.options = {
    callback: function(res) {console.log('You forgot to specify a callback...'); console.dir(res);},
    url: '',
    tabletop_url: undefined,
    tabletop_proxy: undefined,
    tabletop_simplesheet: false,
    preserveFormatting: true,
    simpleKeys: false,
    cache: true,
    staticExport: false,
    fancyOutput: false,
    archieml: false
  };

}(jQuery));
