'use strict';

const gulp = require('gulp');
const mocha = require('gulp-mocha');

gulp.task('default', () => {
	// content
});

gulp.task('test', () => {
	return gulp
			.src([
				'**/*.spec.js',
				'!node_modules/**/*'
			], { read: false })
			.pipe(mocha({
				require: ['./test/helpers/chai.js']
			}));
});
