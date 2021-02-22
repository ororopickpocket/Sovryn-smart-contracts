/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

contract AffiliatesEvents {
	event SetAffiliatesReferrer(address indexed user, address indexed referrer);

	event SetAffiliatesReferrerFail(address indexed user, address indexed referrer, bool alreadySet, bool userNotFirstTrade);

	event WithdrawAffiliatesReferrerTokenFees(
		address indexed referrer,
		address indexed receiver,
		address indexed tokenAddress,
		uint256 amount
	);

	event SetUserNotFirstTradeFlag(address indexed user);

	event PayTradingFeeToAffiliate(address indexed referrer, address indexed feeToken, uint256 fee);
}
