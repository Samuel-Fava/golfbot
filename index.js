console.log('GBB Starting...');

require('dotenv').config(); // Enable .env support if you use it

const debug = require('debug')('GolfBot:startup');
const Joi = require('joi');
Joi.objectId = require('joi-objectid')(Joi);
const config = require('config');
const mongoose = require('mongoose');
const uiCore = new (require('./UI/UICore'))();
const bookingManager = require('./bookingManager');

// === MongoDB Setup ===

// OPTION A: Use direct connection string (quick and dirty)

// OPTION B: Use environment variable from .env (recommended for production)
const mongodbURL = process.env.MONGO_URL; // Fix: Use MONGO_URL instead of MONGO_URI

const opts = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: "GBB"
};

mongoose.connect(mongodbURL, opts)
    .then(async () => {
        const { currentSettings } = require('./models/settings');
        await currentSettings(true);
        console.log("✅ Connected to MongoDB Atlas");

        uiCore.start().then(port => {
            console.log("UI core started on port " + port);
            try {
                const open = require('open');
                open('http://127.0.0.1:' + port);
            } catch (e) { }
        }).catch((error) => {
            console.error("Starting UI core failed.", error);
        });

        const { ReservationFacility } = require('./models/reservationFacility');
        ReservationFacility.findOne().then(result => {
            if (!result) {
                new ReservationFacility({ key: "2431", title: "Bethpage Black Course" }).save();
                new ReservationFacility({ key: "2433", title: "Bethpage Blue Course" }).save();
                new ReservationFacility({ key: "2432", title: "Bethpage Red Course" }).save();
                new ReservationFacility({ key: "2435", title: "Bethpage Yellow Course" }).save();
                new ReservationFacility({ key: "2539", title: "Bethpage Early AM 9 Holes Blue" }).save();
                new ReservationFacility({ key: "2538", title: "Bethpage Early AM 9 Holes Yellow" }).save();
                new ReservationFacility({ key: "2434", title: "Bethpage Green Course" }).save();
                new ReservationFacility({ key: "2517", title: "Bethpage 9 Holes Midday Blue or Yellow Course" }).save();
            };
        }).catch(() => { });

        const Browser = require('./Browser');
        Browser.initialize().then(() => {
            bookingManager.create().then(controller => {
                console.log("BOT core started");

                const { BookingSchedule } = require('./models/bookingSchedules');
                const { CancelationMonitoring } = require('./models/cancelationMonitoring');

                const UpdateRecord = function (record) {
                    controller.deleteBot(record._id.toString());
                };

                uiCore.on('bookingschedule:update', UpdateRecord);
                uiCore.on('bookingschedule:delete', UpdateRecord);
                uiCore.on('cancelationmonitoring:delete', UpdateRecord);
                uiCore.on('cancelationmonitoring:update', UpdateRecord);

                uiCore.on('account:update', (record) => {
                    BookingSchedule.find({ account: record._id, status: 'inprogress' }).then(listBooking => {
                        for (let item of listBooking)
                            UpdateRecord(item);
                    });

                    CancelationMonitoring.find({ account: record._id, status: 'inprogress' }).then(listCancelation => {
                        for (let item of listCancelation)
                            UpdateRecord(item);
                    });
                });

                uiCore.on('settings:update', (newSettings) => {
                    controller.reloadSettings();
                });

                //Browser.newBrowser('http://comtools.net','./data');

            }).catch((error) => console.error("Starting BOT core failed.\n Controller problem:", error));
        }).catch((error) => console.error("Starting BOT core failed..\n Internal browser problem:", error));
    }).catch((error) => console.error('❌ Could not connect to database.', error));
