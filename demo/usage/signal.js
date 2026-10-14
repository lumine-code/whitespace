function average(samples) {
	const total = samples.reduce((sum, value) => sum + value, 0);
	return total / samples.length;
}
