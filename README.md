# Paperback Proxy Server Cacher

Script used to parse the paperback archive backup file and send all the chapters of saved manga (manga in your library) to the [Paperback Proxy Server](https://github.com/kymotsujason/paperback-proxy-server) to pre-download so the response times are improved. I was seeing ~~10x on avg (ie 5000ms to 500ms)~~ 5x (ie 2500ms down to 500ms). **New proxy server updates cuts uncached delays in half.

Supports the following sites:

- Mangadex
- Manganato
- Batoto
- Weebcentral

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. 

### Prerequisites

What things you need to utilize this project and how to install them

```
NodeJS v21+ - https://nodejs.org/en/download
```

### Installing

First thing is to clone the repo

```
git clone https://github.com/kymotsujason/paperback-proxy-server-cacher.git
```

Next is to install the packages

```
npm install
```

Then set up the .env file

```
SITE=<your proxy site url>
TOKEN=<token from SITE/api/login>
```

Now we can run the program

```
node ./index.js
```

## Built With

* [NodeJS](https://nodejs.org/) - The environment used to run the script

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/kymotsujason/paperback-proxy-server-cacher/tags).

## Authors

* **Jason Yue** - *Initial work* - [kymotsujason](https://github.com/kymotsujason)

See also the list of [contributors](https://github.com/kymotsujason/paperback-proxy-server-cacher/contributors) who participated in this project.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details
