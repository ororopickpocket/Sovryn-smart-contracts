/**
 * Copyright 2020, Denis Savelev. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

interface ProtocolAffiliatesInterface {
	function setAffiliatesReferrer(address user, address referrer) external;

	function setUserNotFirstTradeFlag(address user_) external;

	function getUserNotFirstTradeFlag(address user_) external returns (bool);

	function payTradingFeeToAffiliatesReferrer(
		address affiliate,
		address token,
		uint256 amount
	) external returns (uint256);
}
