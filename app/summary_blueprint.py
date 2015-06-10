#!/usr/bin/env python
# encoding: utf-8
from __future__ import (unicode_literals, division,
                        print_function, absolute_import)
from collections import OrderedDict
from flask import request, Blueprint

import json
import scraperwiki

summary = Blueprint('summary', __name__, static_folder='static',
                    static_url_path='/static/summary')


@summary.route('/')
def summarise():
    return summary.send_static_file('summary_tool_index.html')
