Thumbprint
==========

[![Build Status](https://travis-ci.org/auth0/thumbprint.svg?branch=master)](https://travis-ci.org/auth0/thumbprint)

Certificate thumbprint calculator for Node 4, 6 and 8.

## Installation

    $ npm install @auth0/thumbprint

## Usage

```javascript
var thumbprint = require('@auth0/thumbprint');

var result = thumbprint.calculate(base64Certificate);
```